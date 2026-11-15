import type { Knex } from 'knex'

import type { SourceDao, SourceRecord } from '../source-dao.ts'

type SourceRow = {
  id: string
  owner_id: string
  content_hash: string
  file_name: string
  media_type: string
  bytes: number
  width: number
  height: number
  created_at: string
}

function toRecord(row: SourceRow): SourceRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    contentHash: row.content_hash,
    fileName: row.file_name,
    mediaType: row.media_type,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
  }
}

function toRow(record: SourceRecord): SourceRow {
  return {
    id: record.id,
    owner_id: record.ownerId,
    content_hash: record.contentHash,
    file_name: record.fileName,
    media_type: record.mediaType,
    bytes: record.bytes,
    width: record.width,
    height: record.height,
    created_at: record.createdAt,
  }
}

export class SqliteSourceDao implements SourceDao {
  readonly #database: Knex

  constructor(database: Knex) {
    this.#database = database
  }

  insert(
    source: SourceRecord,
  ): Promise<{ source: SourceRecord; created: boolean }> {
    return this.#database.transaction(async (trx) => {
      const existing: SourceRow | undefined = await trx('sources')
        .where({ owner_id: source.ownerId, content_hash: source.contentHash })
        .first()
      if (existing !== undefined) {
        return { source: toRecord(existing), created: false }
      }
      await trx('sources').insert(toRow(source))
      return { source, created: true }
    })
  }

  async findById(id: string): Promise<SourceRecord | null> {
    const row: SourceRow | undefined = await this.#database('sources')
      .where({ id })
      .first()
    return row === undefined ? null : toRecord(row)
  }

  async listByOwner(ownerId: string): Promise<SourceRecord[]> {
    const rows: SourceRow[] = await this.#database('sources')
      .where({ owner_id: ownerId })
      .orderBy('created_at', 'desc')
      .orderBy('id', 'asc')
    return rows.map(toRecord)
  }

  async isReferenced(sourceId: string): Promise<boolean> {
    const asImage = await this.#database('documents')
      .where({ source_id: sourceId })
      .first('id')
    if (asImage !== undefined) return true
    const asOperand = await this.#database('document_operands')
      .where({ source_id: sourceId })
      .first('document_id')
    return asOperand !== undefined
  }

  async delete(id: string): Promise<void> {
    await this.#database('sources').where({ id }).delete()
  }

  async countByHash(contentHash: string): Promise<number> {
    const row = await this.#database('sources')
      .where({ content_hash: contentHash })
      .count({ count: '*' })
      .first()
    return Number(row?.count ?? 0)
  }
}
