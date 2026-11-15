import type { Knex } from 'knex'

import { HistoryPatchSchema } from '@/features/pipeline/document-change'
import { PipelineSchema } from '@/features/pipeline/pipeline'
import {
  ConflictError,
  DataIntegrityError,
  NotFoundError,
} from '../../errors.ts'
import { STALE_DOCUMENT_MESSAGE } from '../document-dao.ts'
import type {
  DocumentDao,
  DocumentRecord,
  HistoryEntryRecord,
  MovedCursor,
  RecordedChange,
} from '../document-dao.ts'

type DocumentRow = {
  id: string
  owner_id: string
  source_id: string
  name: string
  pipeline: string
  revision: number
  history_cursor: number
  created_at: string
  updated_at: string
}

type EntryRow = {
  document_id: string
  position: number
  patch: string
  created_at: string
}

const MISSING = 'That image does not exist.'
const UNREADABLE_EDITS = 'The saved edits of this image could not be read.'

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new DataIntegrityError(UNREADABLE_EDITS, { cause: error })
  }
}

function toRecord(row: DocumentRow): DocumentRecord {
  const pipeline = PipelineSchema.safeParse(parseJson(row.pipeline))
  if (!pipeline.success) {
    throw new DataIntegrityError(UNREADABLE_EDITS, { cause: pipeline.error })
  }
  return {
    id: row.id,
    ownerId: row.owner_id,
    sourceId: row.source_id,
    name: row.name,
    pipeline: pipeline.data,
    revision: row.revision,
    historyCursor: row.history_cursor,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toEntry(row: EntryRow): HistoryEntryRecord {
  const patch = HistoryPatchSchema.safeParse(parseJson(row.patch))
  if (!patch.success) {
    throw new DataIntegrityError(UNREADABLE_EDITS, { cause: patch.error })
  }
  return {
    documentId: row.document_id,
    position: row.position,
    patch: patch.data,
    createdAt: row.created_at,
  }
}

async function lockedRow(
  trx: Knex.Transaction,
  id: string,
  expectedRevision: number,
): Promise<DocumentRow> {
  const row: DocumentRow | undefined = await trx('documents')
    .where({ id })
    .first()
  if (row === undefined) throw new NotFoundError(MISSING)
  if (row.revision !== expectedRevision)
    throw new ConflictError(STALE_DOCUMENT_MESSAGE)
  return row
}

async function linkOperands(
  trx: Knex.Transaction,
  documentId: string,
  sourceIds: string[],
): Promise<void> {
  await trx('document_operands').where({ document_id: documentId }).delete()
  if (sourceIds.length === 0) return
  await trx('document_operands').insert(
    [...new Set(sourceIds)].map((sourceId) => ({
      document_id: documentId,
      source_id: sourceId,
    })),
  )
}

async function reload(
  trx: Knex.Transaction,
  id: string,
): Promise<DocumentRecord> {
  const row: DocumentRow | undefined = await trx('documents')
    .where({ id })
    .first()
  if (row === undefined) throw new NotFoundError(MISSING)
  return toRecord(row)
}

export class SqliteDocumentDao implements DocumentDao {
  readonly #database: Knex

  constructor(database: Knex) {
    this.#database = database
  }

  async insert(document: DocumentRecord): Promise<void> {
    await this.#database('documents').insert({
      id: document.id,
      owner_id: document.ownerId,
      source_id: document.sourceId,
      name: document.name,
      pipeline: JSON.stringify(document.pipeline),
      revision: document.revision,
      history_cursor: document.historyCursor,
      created_at: document.createdAt,
      updated_at: document.updatedAt,
    })
  }

  async findById(id: string): Promise<DocumentRecord | null> {
    const row: DocumentRow | undefined = await this.#database('documents')
      .where({ id })
      .first()
    return row === undefined ? null : toRecord(row)
  }

  async listByOwner(ownerId: string): Promise<DocumentRecord[]> {
    const rows: DocumentRow[] = await this.#database('documents')
      .where({ owner_id: ownerId })
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'asc')
    return rows.map(toRecord)
  }

  async rename(id: string, name: string, now: string): Promise<DocumentRecord> {
    return this.#database.transaction(async (trx) => {
      const count = await trx('documents')
        .where({ id })
        .update({ name, updated_at: now })
      if (count === 0) throw new NotFoundError(MISSING)
      return reload(trx, id)
    })
  }

  async delete(id: string): Promise<void> {
    await this.#database('documents').where({ id }).delete()
  }

  applyChange(change: RecordedChange): Promise<DocumentRecord> {
    return this.#database.transaction(async (trx) => {
      const row = await lockedRow(trx, change.id, change.expectedRevision)
      await trx('history_entries')
        .where({ document_id: change.id })
        .andWhere('position', '>=', row.history_cursor)
        .delete()
      await trx('history_entries').insert({
        document_id: change.id,
        position: row.history_cursor,
        patch: JSON.stringify(change.patch),
        created_at: change.now,
      })
      const cursor = row.history_cursor + 1
      await trx('history_entries')
        .where({ document_id: change.id })
        .andWhere('position', '<', cursor - change.maxEntries)
        .delete()
      await linkOperands(trx, change.id, change.operandSourceIds)
      await trx('documents')
        .where({ id: change.id })
        .update({
          pipeline: JSON.stringify(change.pipeline),
          revision: row.revision + 1,
          history_cursor: cursor,
          updated_at: change.now,
        })
      return reload(trx, change.id)
    })
  }

  moveCursor(move: MovedCursor): Promise<DocumentRecord> {
    return this.#database.transaction(async (trx) => {
      const row = await lockedRow(trx, move.id, move.expectedRevision)
      await linkOperands(trx, move.id, move.operandSourceIds)
      await trx('documents')
        .where({ id: move.id })
        .update({
          pipeline: JSON.stringify(move.pipeline),
          revision: row.revision + 1,
          history_cursor: move.cursor,
          updated_at: move.now,
        })
      return reload(trx, move.id)
    })
  }

  async findEntry(
    documentId: string,
    position: number,
  ): Promise<HistoryEntryRecord | null> {
    const row: EntryRow | undefined = await this.#database('history_entries')
      .where({ document_id: documentId, position })
      .first()
    return row === undefined ? null : toEntry(row)
  }

  async listBySource(sourceId: string): Promise<DocumentRecord[]> {
    const rows: DocumentRow[] = await this.#database('documents')
      .where({ source_id: sourceId })
      .orWhereIn(
        'id',
        this.#database('document_operands')
          .where({ source_id: sourceId })
          .select('document_id'),
      )
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'asc')
    return rows.map(toRecord)
  }
}
