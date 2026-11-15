import type { Knex } from 'knex'

import type {
  ResultDao,
  ResultFilter,
  ResultKind,
  ResultRecord,
} from '../result-dao.ts'

type ResultRow = {
  id: string
  owner_id: string
  kind: string
  key: string
  document_id: string | null
  step_id: string | null
  workflow_run_id: string | null
  file_name: string
  media_type: string
  bytes: number
  created_at: string
}

function toRecord(row: ResultRow): ResultRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    kind: row.kind as ResultKind,
    key: row.key,
    documentId: row.document_id,
    stepId: row.step_id,
    workflowRunId: row.workflow_run_id,
    fileName: row.file_name,
    mediaType: row.media_type,
    bytes: row.bytes,
    createdAt: row.created_at,
  }
}

export class SqliteResultDao implements ResultDao {
  readonly #database: Knex

  constructor(database: Knex) {
    this.#database = database
  }

  async insert(result: ResultRecord): Promise<void> {
    await this.#database('results').insert({
      id: result.id,
      owner_id: result.ownerId,
      kind: result.kind,
      key: result.key,
      document_id: result.documentId,
      step_id: result.stepId,
      workflow_run_id: result.workflowRunId,
      file_name: result.fileName,
      media_type: result.mediaType,
      bytes: result.bytes,
      created_at: result.createdAt,
    })
  }

  async findById(id: string): Promise<ResultRecord | null> {
    const row: ResultRow | undefined = await this.#database('results')
      .where({ id })
      .first()
    return row === undefined ? null : toRecord(row)
  }

  async findByKey(ownerId: string, key: string): Promise<ResultRecord | null> {
    const row: ResultRow | undefined = await this.#database('results')
      .where({ owner_id: ownerId, key })
      .orderBy('created_at', 'desc')
      .first()
    return row === undefined ? null : toRecord(row)
  }

  async list(ownerId: string, filter: ResultFilter): Promise<ResultRecord[]> {
    const query = this.#database('results').where({ owner_id: ownerId })
    if (filter.documentId !== undefined)
      query.andWhere({ document_id: filter.documentId })
    if (filter.workflowRunId !== undefined) {
      query.andWhere({ workflow_run_id: filter.workflowRunId })
    }
    if (filter.kind !== undefined) query.andWhere({ kind: filter.kind })
    const rows: ResultRow[] = await query
      .orderBy('created_at', 'desc')
      .orderBy('id', 'asc')
    return rows.map(toRecord)
  }

  async delete(id: string): Promise<void> {
    await this.#database('results').where({ id }).delete()
  }

  async deleteForDocument(documentId: string): Promise<void> {
    await this.#database('results').where({ document_id: documentId }).delete()
  }

  async countByKey(key: string): Promise<number> {
    const row = await this.#database('results')
      .where({ key })
      .count({ count: '*' })
      .first()
    return Number(row?.count ?? 0)
  }

  async sumBytes(ownerId: string): Promise<number> {
    const row = await this.#database('results')
      .where({ owner_id: ownerId })
      .sum({ total: 'bytes' })
      .first()
    return Number(row?.total ?? 0)
  }
}
