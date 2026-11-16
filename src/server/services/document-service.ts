import type {
  DocumentSummary,
  DocumentView,
} from '@/features/documents/document'
import { MAX_DOCUMENT_NAME_LENGTH } from '@/features/documents/document'
import type { SourceSummary } from '@/features/documents/document'
import {
  InvalidChangeError,
  MAX_HISTORY_ENTRIES,
  applyChange,
  planChange,
} from '@/features/pipeline/document-change'
import type { DocumentChange } from '@/features/pipeline/document-change'
import { pipelineOperandSourceIds } from '@/features/pipeline/image-operands'
import {
  PipelineStepKind,
  createSourceStep,
  firstSourceStep,
} from '@/features/pipeline/pipeline'
import type { Pipeline } from '@/features/pipeline/pipeline'
import { STALE_DOCUMENT_MESSAGE } from '../dao/document-dao.ts'
import type { DocumentDao, DocumentRecord } from '../dao/document-dao.ts'
import type { SourceDao } from '../dao/source-dao.ts'
import type { Actor } from '../domain/actor.ts'
import { isoNow } from '../domain/clock.ts'
import type { Clock, IdGenerator } from '../domain/clock.ts'
import { requireOwned } from '../domain/ownership.ts'
import { ConflictError, ValidationError } from '../errors.ts'
import { toSourceSummary } from './source-service.ts'

const MISSING_IMAGE = 'That image does not exist.'
const MISSING_OPERAND = 'An image used by this step does not exist.'
const NOTHING_TO_UNDO = 'There is nothing to undo.'
const NOTHING_TO_REDO = 'There is nothing to redo.'

/** What else has to go when a Document is deleted: its Results, its Jobs. */
export interface DocumentCleanup {
  onDocumentDeleted(actor: Actor, documentId: string): Promise<void>
}

export type DocumentServiceDependencies = {
  documents: DocumentDao
  sources: SourceDao
  clock: Clock
  ids: IdGenerator
  cleanup: DocumentCleanup
}

function cleanName(raw: string): string {
  const name = raw.trim()
  if (name === '') throw new ValidationError('Enter a name.')
  if (name.length > MAX_DOCUMENT_NAME_LENGTH) {
    throw new ValidationError(
      `Use ${MAX_DOCUMENT_NAME_LENGTH} characters or fewer.`,
    )
  }
  return name
}

function nameFromFile(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  return stem.slice(0, MAX_DOCUMENT_NAME_LENGTH).trim() || 'Image'
}

/**
 * The editable thing: an image's Pipeline and History. Every method takes the
 * actor and checks ownership first, so the rule holds for a web request, a
 * CLI command and a queued Job alike.
 */
export class DocumentService {
  readonly #deps: DocumentServiceDependencies

  constructor(deps: DocumentServiceDependencies) {
    this.#deps = deps
  }

  async create(
    actor: Actor,
    sourceId: string,
    name?: string,
  ): Promise<DocumentView> {
    const { sources, documents, clock, ids } = this.#deps
    const source = requireOwned(
      actor,
      await sources.findById(sourceId),
      MISSING_IMAGE,
    )
    const now = isoNow(clock)
    const record: DocumentRecord = {
      id: ids.next(),
      ownerId: actor.userId,
      name:
        name === undefined ? nameFromFile(source.fileName) : cleanName(name),
      pipeline: { steps: [createSourceStep(source.id)] },
      revision: 0,
      historyCursor: 0,
      createdAt: now,
      updatedAt: now,
    }
    await documents.insert(record, [source.id])
    return this.#view(record)
  }

  async list(actor: Actor): Promise<DocumentSummary[]> {
    const { documents } = this.#deps
    const summaries: DocumentSummary[] = []
    for (const record of await documents.listByOwner(actor.userId)) {
      const [source] = await this.#openedSources(record.pipeline)
      summaries.push({
        id: record.id,
        name: record.name,
        source: source ?? null,
        revision: record.revision,
        updatedAt: record.updatedAt,
      })
    }
    return summaries
  }

  async get(actor: Actor, id: string): Promise<DocumentView> {
    return this.#view(await this.#owned(actor, id))
  }

  async rename(actor: Actor, id: string, name: string): Promise<DocumentView> {
    await this.#owned(actor, id)
    const renamed = await this.#deps.documents.rename(
      id,
      cleanName(name),
      isoNow(this.#deps.clock),
    )
    return this.#view(renamed)
  }

  async delete(actor: Actor, id: string): Promise<void> {
    await this.#owned(actor, id)
    await this.#deps.cleanup.onDocumentDeleted(actor, id)
    await this.#deps.documents.delete(id)
  }

  /** Applies one edit as one History entry; `revision` is the one the caller last saw. */
  async change(
    actor: Actor,
    id: string,
    revision: number,
    change: DocumentChange,
  ): Promise<DocumentView> {
    const record = await this.#current(actor, id, revision)
    const planned = this.#plan(record.pipeline, change)
    if (planned === null) return this.#view(record)
    const operandSourceIds = await this.#ownedOperands(actor, planned.pipeline)
    const changed = await this.#deps.documents.applyChange({
      id,
      expectedRevision: revision,
      pipeline: planned.pipeline,
      operandSourceIds,
      patch: planned.patch,
      maxEntries: MAX_HISTORY_ENTRIES,
      now: isoNow(this.#deps.clock),
    })
    return this.#view(changed)
  }

  undo(actor: Actor, id: string, revision: number): Promise<DocumentView> {
    return this.#step(actor, id, revision, -1)
  }

  redo(actor: Actor, id: string, revision: number): Promise<DocumentView> {
    return this.#step(actor, id, revision, 0)
  }

  /**
   * Undo applies the inverse of the entry below the cursor; redo applies the
   * forward change of the entry at the cursor.
   */
  async #step(
    actor: Actor,
    id: string,
    revision: number,
    offset: -1 | 0,
  ): Promise<DocumentView> {
    const { documents, clock } = this.#deps
    const record = await this.#current(actor, id, revision)
    const position = record.historyCursor + offset
    const entry = await documents.findEntry(id, position)
    if (entry === null) {
      throw new ValidationError(
        offset === -1 ? NOTHING_TO_UNDO : NOTHING_TO_REDO,
      )
    }
    const change = offset === -1 ? entry.patch.inverse : entry.patch.forward
    const pipeline = this.#apply(record.pipeline, change)
    const moved = await documents.moveCursor({
      id,
      expectedRevision: revision,
      pipeline,
      operandSourceIds: pipelineOperandSourceIds(pipeline),
      cursor:
        offset === -1 ? record.historyCursor - 1 : record.historyCursor + 1,
      now: isoNow(clock),
    })
    return this.#view(moved)
  }

  /** The Document, if it is still on the revision the caller saw. */
  async #current(
    actor: Actor,
    id: string,
    revision: number,
  ): Promise<DocumentRecord> {
    const record = await this.#owned(actor, id)
    if (record.revision !== revision)
      throw new ConflictError(STALE_DOCUMENT_MESSAGE)
    return record
  }

  async #owned(actor: Actor, id: string): Promise<DocumentRecord> {
    return requireOwned(
      actor,
      await this.#deps.documents.findById(id),
      MISSING_IMAGE,
    )
  }

  #plan(pipeline: Pipeline, change: DocumentChange) {
    try {
      return planChange(pipeline, change)
    } catch (error) {
      throw asValidation(error)
    }
  }

  #apply(pipeline: Pipeline, change: DocumentChange): Pipeline {
    try {
      return applyChange(pipeline, change)
    } catch (error) {
      throw asValidation(error)
    }
  }

  /** The Sources a Pipeline uses as second images must all be the actor's own. */
  async #ownedOperands(actor: Actor, pipeline: Pipeline): Promise<string[]> {
    const ids = pipelineOperandSourceIds(pipeline)
    for (const id of ids) {
      requireOwned(
        actor,
        await this.#deps.sources.findById(id),
        MISSING_OPERAND,
      )
    }
    return ids
  }

  /** The images the Open image steps open, in order, leaving out any that are gone. */
  async #openedSources(pipeline: Pipeline): Promise<SourceSummary[]> {
    const summaries: SourceSummary[] = []
    const seen = new Set<string>()
    for (const step of pipeline.steps) {
      if (step.kind !== PipelineStepKind.Source || seen.has(step.sourceId)) {
        continue
      }
      seen.add(step.sourceId)
      const source = await this.#deps.sources.findById(step.sourceId)
      if (source !== null) summaries.push(toSourceSummary(source))
    }
    return summaries
  }

  async #view(record: DocumentRecord): Promise<DocumentView> {
    const { documents } = this.#deps
    const sources = await this.#openedSources(record.pipeline)
    const first = firstSourceStep(record.pipeline)
    const source = sources.find(({ id }) => id === first?.sourceId) ?? null
    const undo = await documents.findEntry(record.id, record.historyCursor - 1)
    const redo = await documents.findEntry(record.id, record.historyCursor)
    return {
      id: record.id,
      name: record.name,
      source,
      sources,
      pipeline: record.pipeline,
      revision: record.revision,
      canUndo: undo !== null,
      canRedo: redo !== null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  }
}

function asValidation(error: unknown): unknown {
  return error instanceof InvalidChangeError
    ? new ValidationError(error.message, { cause: error })
    : error
}
