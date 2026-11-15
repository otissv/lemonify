import type { Knex } from 'knex'

import type { WorkerPool } from '@/features/ai/ai-tools'

import { DataIntegrityError } from '../../errors.ts'
import {
  JobPayloadSchema,
  JobResultSchema,
  JobState,
} from '../../jobs/job-types.ts'
import type { JobKind, JobOutcome, JobRecord } from '../../jobs/job-types.ts'
import type {
  ActiveJobFilter,
  CancelResult,
  JobDao,
  JobFilter,
} from '../job-dao.ts'

type JobRow = {
  id: string
  kind: string
  owner_id: string
  pool: string
  priority: number
  group_key: string
  document_id: string | null
  workflow_run_id: string | null
  state: string
  progress: number
  payload: string
  result: string | null
  error: string | null
  claimed_by: string | null
  cancel_requested: number
  created_at: string
  started_at: string | null
  finished_at: string | null
}

const UNREADABLE = 'A saved job could not be read.'
const ACTIVE = [JobState.Waiting, JobState.Running]

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new DataIntegrityError(UNREADABLE, { cause: error })
  }
}

function toRecord(row: JobRow): JobRecord {
  const payload = JobPayloadSchema.safeParse(parseJson(row.payload))
  if (!payload.success) {
    throw new DataIntegrityError(UNREADABLE, { cause: payload.error })
  }
  let result: JobRecord['result'] = null
  if (row.result !== null) {
    const parsed = JobResultSchema.safeParse(parseJson(row.result))
    if (!parsed.success) {
      throw new DataIntegrityError(UNREADABLE, { cause: parsed.error })
    }
    result = parsed.data
  }
  return {
    id: row.id,
    kind: row.kind as JobKind,
    ownerId: row.owner_id,
    pool: row.pool as WorkerPool,
    priority: row.priority,
    groupKey: row.group_key,
    documentId: row.document_id,
    workflowRunId: row.workflow_run_id,
    state: row.state as JobState,
    progress: row.progress,
    payload: payload.data,
    result,
    error: row.error,
    claimedBy: row.claimed_by,
    cancelRequested: row.cancel_requested === 1,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

function toRow(job: JobRecord): JobRow {
  return {
    id: job.id,
    kind: job.kind,
    owner_id: job.ownerId,
    pool: job.pool,
    priority: job.priority,
    group_key: job.groupKey,
    document_id: job.documentId,
    workflow_run_id: job.workflowRunId,
    state: job.state,
    progress: job.progress,
    payload: JSON.stringify(job.payload),
    result: job.result === null ? null : JSON.stringify(job.result),
    error: job.error,
    claimed_by: job.claimedBy,
    cancel_requested: job.cancelRequested ? 1 : 0,
    created_at: job.createdAt,
    started_at: job.startedAt,
    finished_at: job.finishedAt,
  }
}

function outcomeColumns(
  outcome: JobOutcome,
  now: string,
  stopped: boolean,
): Record<string, unknown> {
  const columns: Record<string, unknown> = {
    state:
      stopped && outcome.state === JobState.Done
        ? JobState.Cancelled
        : outcome.state,
    finished_at: now,
  }
  if (outcome.state === JobState.Done) {
    columns.result = JSON.stringify(outcome.result)
    columns.progress = 1
  }
  if (outcome.state === JobState.Failed) columns.error = outcome.error
  return columns
}

export class SqliteJobDao implements JobDao {
  readonly #database: Knex

  constructor(database: Knex) {
    this.#database = database
  }

  async enqueue(jobs: ReadonlyArray<JobRecord>): Promise<void> {
    if (jobs.length === 0) return
    await this.#database.transaction(async (trx) => {
      await trx('jobs').insert(jobs.map(toRow))
    })
  }

  async findById(id: string): Promise<JobRecord | null> {
    const row: JobRow | undefined = await this.#database('jobs')
      .where({ id })
      .first()
    return row === undefined ? null : toRecord(row)
  }

  async list(ownerId: string, filter: JobFilter): Promise<JobRecord[]> {
    const query = this.#database('jobs').where({ owner_id: ownerId })
    if (filter.state !== undefined) query.whereIn('state', [...filter.state])
    if (filter.kind !== undefined) query.andWhere({ kind: filter.kind })
    if (filter.documentId !== undefined)
      query.andWhere({ document_id: filter.documentId })
    if (filter.workflowRunId !== undefined) {
      query.andWhere({ workflow_run_id: filter.workflowRunId })
    }
    query.orderBy('created_at', 'desc').orderBy('id', 'asc')
    if (filter.limit !== undefined) query.limit(filter.limit)
    const rows: JobRow[] = await query
    return rows.map(toRecord)
  }

  async listActive(filter: ActiveJobFilter): Promise<JobRecord[]> {
    const query = this.#database('jobs').whereIn('state', ACTIVE)
    if (filter.documentId !== undefined)
      query.andWhere({ document_id: filter.documentId })
    if (filter.workflowRunId !== undefined) {
      query.andWhere({ workflow_run_id: filter.workflowRunId })
    }
    if (filter.kinds !== undefined) query.whereIn('kind', [...filter.kinds])
    const rows: JobRow[] = await query
      .orderBy('priority', 'asc')
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
    return rows.map(toRecord)
  }

  async listWaiting(pool: WorkerPool): Promise<JobRecord[]> {
    const rows: JobRow[] = await this.#database('jobs')
      .where({ state: JobState.Waiting, pool })
      .orderBy('priority', 'asc')
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
    return rows.map(toRecord)
  }

  async listRunning(): Promise<JobRecord[]> {
    const rows: JobRow[] = await this.#database('jobs').where({
      state: JobState.Running,
    })
    return rows.map(toRecord)
  }

  async countRunningByGroup(pool: WorkerPool): Promise<Map<string, number>> {
    const rows: Array<{ group_key: string; count: number | string }> =
      await this.#database('jobs')
        .where({ state: JobState.Running, pool })
        .groupBy('group_key')
        .select('group_key')
        .count({ count: '*' })
    return new Map(rows.map((row) => [row.group_key, Number(row.count)]))
  }

  async countWaitingForOwner(ownerId: string): Promise<number> {
    const row = await this.#database('jobs')
      .where({ owner_id: ownerId, state: JobState.Waiting })
      .count({ count: '*' })
      .first()
    return Number(row?.count ?? 0)
  }

  async claim(id: string, claimedBy: string, now: string): Promise<boolean> {
    const changed = await this.#database('jobs')
      .where({ id, state: JobState.Waiting, cancel_requested: 0 })
      .update({
        state: JobState.Running,
        claimed_by: claimedBy,
        started_at: now,
      })
    return changed === 1
  }

  async setProgress(id: string, progress: number): Promise<void> {
    await this.#database('jobs')
      .where({ id, state: JobState.Running })
      .update({ progress })
  }

  async requestCancel(id: string, now: string): Promise<CancelResult> {
    const dropped = await this.#database('jobs')
      .where({ id, state: JobState.Waiting })
      .update({ state: JobState.Cancelled, finished_at: now })
    if (dropped === 1) return 'cancelled'
    const asked = await this.#database('jobs')
      .where({ id, state: JobState.Running })
      .update({ cancel_requested: 1 })
    return asked === 1 ? 'requested' : 'finished'
  }

  async finish(
    id: string,
    outcome: JobOutcome,
    next: ReadonlyArray<JobRecord>,
    now: string,
  ): Promise<boolean> {
    return this.#database.transaction(async (trx) => {
      const current: Pick<JobRow, 'cancel_requested'> | undefined = await trx(
        'jobs',
      )
        .where({ id, state: JobState.Running })
        .first('cancel_requested')
      if (current === undefined) return false
      const stopped = current.cancel_requested === 1
      await trx('jobs')
        .where({ id })
        .update(outcomeColumns(outcome, now, stopped))
      if (next.length > 0 && !stopped) {
        await trx('jobs').insert(next.map(toRow))
      }
      return true
    })
  }

  async deleteFinishedBefore(cutoff: string): Promise<number> {
    return this.#database('jobs')
      .whereNotNull('finished_at')
      .andWhere('finished_at', '<', cutoff)
      .delete()
  }
}
