import type { Knex } from 'knex'

import { WorkflowHistoryPatchSchema } from '@/features/workflows/workflow-change'
import { WorkflowDefinitionSchema } from '@/features/workflows/workflow'
import type { WorkflowDefinition } from '@/features/workflows/workflow'

import {
  ConflictError,
  DataIntegrityError,
  NotFoundError,
} from '../../errors.ts'
import { STALE_WORKFLOW_MESSAGE } from '../workflow-dao.ts'
import type {
  MovedWorkflowCursor,
  RecordedWorkflowChange,
  RunState,
  WorkflowDao,
  WorkflowHistoryEntryRecord,
  WorkflowRecord,
  WorkflowRunRecord,
} from '../workflow-dao.ts'

type WorkflowRow = {
  id: string
  owner_id: string
  name: string
  definition: string
  revision: number
  history_cursor: number
  created_at: string
  updated_at: string
}

type EntryRow = {
  workflow_id: string
  position: number
  patch: string
  created_at: string
}

type RunRow = {
  id: string
  workflow_id: string | null
  owner_id: string
  definition: string
  state: string
  created_at: string
  finished_at: string | null
}

const MISSING = 'That workflow does not exist.'
const UNREADABLE = 'A saved workflow could not be read.'
const UNREADABLE_EDITS = 'The saved edits of this workflow could not be read.'

function parseDefinition(text: string): WorkflowDefinition {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new DataIntegrityError(UNREADABLE, { cause: error })
  }
  const definition = WorkflowDefinitionSchema.safeParse(json)
  if (!definition.success) {
    throw new DataIntegrityError(UNREADABLE, { cause: definition.error })
  }
  return definition.data
}

function toWorkflow(row: WorkflowRow): WorkflowRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    definition: parseDefinition(row.definition),
    revision: row.revision,
    historyCursor: row.history_cursor,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toEntry(row: EntryRow): WorkflowHistoryEntryRecord {
  let json: unknown
  try {
    json = JSON.parse(row.patch)
  } catch (error) {
    throw new DataIntegrityError(UNREADABLE_EDITS, { cause: error })
  }
  const patch = WorkflowHistoryPatchSchema.safeParse(json)
  if (!patch.success) {
    throw new DataIntegrityError(UNREADABLE_EDITS, { cause: patch.error })
  }
  return {
    workflowId: row.workflow_id,
    position: row.position,
    patch: patch.data,
    createdAt: row.created_at,
  }
}

async function lockedRow(
  trx: Knex.Transaction,
  id: string,
  expectedRevision: number,
): Promise<WorkflowRow> {
  const row: WorkflowRow | undefined = await trx('workflows')
    .where({ id })
    .first()
  if (row === undefined) throw new NotFoundError(MISSING)
  if (row.revision !== expectedRevision) {
    throw new ConflictError(STALE_WORKFLOW_MESSAGE)
  }
  return row
}

async function reload(
  trx: Knex.Transaction,
  id: string,
): Promise<WorkflowRecord> {
  const row: WorkflowRow | undefined = await trx('workflows')
    .where({ id })
    .first()
  if (row === undefined) throw new NotFoundError(MISSING)
  return toWorkflow(row)
}

function toRun(row: RunRow): WorkflowRunRecord {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    ownerId: row.owner_id,
    definition: parseDefinition(row.definition),
    state: row.state as RunState,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  }
}

export class SqliteWorkflowDao implements WorkflowDao {
  readonly #database: Knex

  constructor(database: Knex) {
    this.#database = database
  }

  async insert(workflow: WorkflowRecord): Promise<void> {
    await this.#database('workflows').insert({
      id: workflow.id,
      owner_id: workflow.ownerId,
      name: workflow.name,
      definition: JSON.stringify(workflow.definition),
      revision: workflow.revision,
      history_cursor: workflow.historyCursor,
      created_at: workflow.createdAt,
      updated_at: workflow.updatedAt,
    })
  }

  async findById(id: string): Promise<WorkflowRecord | null> {
    const row: WorkflowRow | undefined = await this.#database('workflows')
      .where({ id })
      .first()
    return row === undefined ? null : toWorkflow(row)
  }

  async listByOwner(ownerId: string): Promise<WorkflowRecord[]> {
    const rows: WorkflowRow[] = await this.#database('workflows')
      .where({ owner_id: ownerId })
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'asc')
    return rows.map(toWorkflow)
  }

  rename(id: string, name: string, now: string): Promise<WorkflowRecord> {
    return this.#database.transaction(async (trx) => {
      const count = await trx('workflows')
        .where({ id })
        .update({ name, updated_at: now })
      if (count === 0) throw new NotFoundError(MISSING)
      return reload(trx, id)
    })
  }

  applyChange(change: RecordedWorkflowChange): Promise<WorkflowRecord> {
    return this.#database.transaction(async (trx) => {
      const row = await lockedRow(trx, change.id, change.expectedRevision)
      await trx('workflow_history')
        .where({ workflow_id: change.id })
        .andWhere('position', '>=', row.history_cursor)
        .delete()
      await trx('workflow_history').insert({
        workflow_id: change.id,
        position: row.history_cursor,
        patch: JSON.stringify(change.patch),
        created_at: change.now,
      })
      const cursor = row.history_cursor + 1
      await trx('workflow_history')
        .where({ workflow_id: change.id })
        .andWhere('position', '<', cursor - change.maxEntries)
        .delete()
      await trx('workflows')
        .where({ id: change.id })
        .update({
          definition: JSON.stringify(change.definition),
          revision: row.revision + 1,
          history_cursor: cursor,
          updated_at: change.now,
        })
      return reload(trx, change.id)
    })
  }

  moveCursor(move: MovedWorkflowCursor): Promise<WorkflowRecord> {
    return this.#database.transaction(async (trx) => {
      const row = await lockedRow(trx, move.id, move.expectedRevision)
      await trx('workflows')
        .where({ id: move.id })
        .update({
          definition: JSON.stringify(move.definition),
          revision: row.revision + 1,
          history_cursor: move.cursor,
          updated_at: move.now,
        })
      return reload(trx, move.id)
    })
  }

  async findEntry(
    workflowId: string,
    position: number,
  ): Promise<WorkflowHistoryEntryRecord | null> {
    const row: EntryRow | undefined = await this.#database('workflow_history')
      .where({ workflow_id: workflowId, position })
      .first()
    return row === undefined ? null : toEntry(row)
  }

  async delete(id: string): Promise<void> {
    await this.#database('workflows').where({ id }).delete()
  }

  async insertRun(run: WorkflowRunRecord): Promise<void> {
    await this.#database('workflow_runs').insert({
      id: run.id,
      workflow_id: run.workflowId,
      owner_id: run.ownerId,
      definition: JSON.stringify(run.definition),
      state: run.state,
      created_at: run.createdAt,
      finished_at: run.finishedAt,
    })
  }

  async deleteRun(id: string): Promise<void> {
    await this.#database('workflow_runs').where({ id }).delete()
  }

  async findRun(id: string): Promise<WorkflowRunRecord | null> {
    const row: RunRow | undefined = await this.#database('workflow_runs')
      .where({ id })
      .first()
    return row === undefined ? null : toRun(row)
  }

  async listRuns(
    ownerId: string,
    workflowId?: string,
  ): Promise<WorkflowRunRecord[]> {
    const query = this.#database('workflow_runs').where({ owner_id: ownerId })
    if (workflowId !== undefined) query.andWhere({ workflow_id: workflowId })
    const rows: RunRow[] = await query
      .orderBy('created_at', 'desc')
      .orderBy('id', 'asc')
    return rows.map(toRun)
  }

  async updateRunState(
    id: string,
    state: RunState,
    finishedAt: string | null,
  ): Promise<void> {
    await this.#database('workflow_runs')
      .where({ id })
      .update({ state, finished_at: finishedAt })
  }
}
