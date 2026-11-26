import { remapPipelineSources } from '@/features/pipeline/image-operands'
import type { Pipeline } from '@/features/pipeline/pipeline'
import { remapUsedItems } from '@/features/pipeline/used-item-ids'
import { MAX_WORKFLOW_NAME_LENGTH } from '@/features/workflows/workflow'
import { uniqueName } from '@/lib/unique-name'

import type { Manifest } from '../bundle/manifest.ts'
import type { Actor } from '../domain/actor.ts'
import { ValidationError } from '../errors.ts'
import type { DocumentBundleServiceDependencies } from './document-bundle-types.ts'
import { usedRefs } from './used-items.ts'
import type { ItemRef } from './used-items.ts'

const UNKNOWN_ITEM =
  'The document uses a document or workflow that is not in the file.'
const UNKNOWN_IMAGE = 'The document uses an image that is not in the file.'
const CIRCULAR = 'A document or workflow in the file leads back to itself.'

type Entry =
  | { kind: 'document'; item: Manifest['documents'][number] }
  | { kind: 'workflow'; item: Manifest['workflows'][number] }

function pipelineOf(entry: Entry): Pipeline {
  return entry.kind === 'document'
    ? entry.item.pipeline
    : entry.item.definition.pipeline
}

/**
 * Makes the documents and workflows a document file's layers use, each anew
 * for the actor, those an item uses before it, so every layer points at an
 * item that exists and is the actor's. Undo removes them again, the last made
 * first, so none is removed while another still uses it.
 */
export class UsedItemsImport {
  readonly #deps: DocumentBundleServiceDependencies
  readonly #actor: Actor
  readonly #entries = new Map<string, Entry>()
  readonly #sourceIds: ReadonlyMap<string, string>
  /** The id each item has in the file, to the id of the item made from it. */
  readonly ids = new Map<string, string>()
  readonly #made: ItemRef[] = []

  constructor(
    deps: DocumentBundleServiceDependencies,
    actor: Actor,
    manifest: Manifest,
    sourceIds: ReadonlyMap<string, string>,
  ) {
    this.#deps = deps
    this.#actor = actor
    this.#sourceIds = sourceIds
    for (const item of manifest.documents) {
      this.#entries.set(item.id, { kind: 'document', item })
    }
    for (const item of manifest.workflows) {
      this.#entries.set(item.id, { kind: 'workflow', item })
    }
  }

  async run(): Promise<void> {
    for (const id of this.#entries.keys()) await this.#make(id, [])
  }

  /** `pipeline` with the actor's images and the items made for it. */
  remap(pipeline: Pipeline): Pipeline {
    let withImages: Pipeline
    try {
      withImages = remapPipelineSources(pipeline, this.#sourceIds)
    } catch (error) {
      if (error instanceof RangeError) {
        throw new ValidationError(UNKNOWN_IMAGE, { cause: error })
      }
      throw error
    }
    try {
      return remapUsedItems(withImages, this.ids)
    } catch (error) {
      if (error instanceof RangeError) {
        throw new ValidationError(UNKNOWN_ITEM, { cause: error })
      }
      throw error
    }
  }

  /** Checks that every item the pipeline uses is in the file. */
  requireHeld(pipeline: Pipeline): void {
    for (const ref of usedRefs(pipeline.steps)) {
      if (this.#entries.get(ref.id)?.kind !== ref.kind) {
        throw new ValidationError(UNKNOWN_ITEM)
      }
    }
  }

  async #make(id: string, path: ReadonlyArray<string>): Promise<string> {
    const made = this.ids.get(id)
    if (made !== undefined) return made
    if (path.includes(id)) throw new ValidationError(CIRCULAR)
    const entry = this.#entries.get(id)
    if (entry === undefined) throw new ValidationError(UNKNOWN_ITEM)
    const pipeline = pipelineOf(entry)
    this.requireHeld(pipeline)
    for (const ref of usedRefs(pipeline.steps)) {
      await this.#make(ref.id, [...path, id])
    }
    const newId = await this.#create(entry)
    this.ids.set(id, newId)
    return newId
  }

  async #create(entry: Entry): Promise<string> {
    const { documentService, workflowService } = this.#deps
    if (entry.kind === 'document') {
      const { name, pipeline } = entry.item
      const document = await documentService.createFromPipeline(
        this.#actor,
        name,
        this.remap(pipeline),
      )
      this.#made.push({ kind: 'document', id: document.id })
      return document.id
    }
    const { name, definition } = entry.item
    const inputs: string[] = []
    for (const input of definition.inputs) {
      const mine = this.#sourceIds.get(input)
      if (mine === undefined) throw new ValidationError(UNKNOWN_IMAGE)
      inputs.push(mine)
    }
    const workflow = await workflowService.create(
      this.#actor,
      uniqueName(
        name,
        await workflowService.list(this.#actor),
        MAX_WORKFLOW_NAME_LENGTH,
      ),
      { ...definition, pipeline: this.remap(definition.pipeline), inputs },
    )
    this.#made.push({ kind: 'workflow', id: workflow.id })
    return workflow.id
  }

  /** Removes the items this import made, the last made first. */
  async undo(): Promise<void> {
    const { documentService, workflowService } = this.#deps
    for (const ref of [...this.#made].reverse()) {
      if (ref.kind === 'document') {
        await documentService.delete(this.#actor, ref.id)
      } else {
        await workflowService.delete(this.#actor, ref.id)
      }
    }
  }
}
