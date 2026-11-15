import type { Knex } from 'knex'

import { WorkflowGraphSchema } from '@/features/workflows/workflow'
import type { WorkflowGraph } from '@/features/workflows/workflow'

import {
  ConflictError,
  DataIntegrityError,
  NotFoundError,
} from '../../errors.ts'
import { STALE_WORKFLOW_MESSAGE } from '../workflow-dao.ts'
import type {
  RunState,
  WorkflowDao,
  WorkflowRecord,
  WorkflowRunRecord,
} from '../workflow-dao.ts'

type WorkflowRow = {
  id: string
  owner_id: string
  name: string
  graph: string
  revision: number
  created_at: string
  updated_at: string
}

type RunRow = {
  id: string
  workflow_id: string | null
  owner_id: string
  graph: string
  state: string
  created_at: string
  finished_at: string | null
}

const MISSING = 'That workflow does not exist.'
const UNREADABLE = 'A saved workflow could not be read.'

function parseGraph(text: string): WorkflowGraph {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new DataIntegrityError(UNREADABLE, { cause: error })
  }
  const graph = WorkflowGraphSchema.safeParse(json)
  if (!graph.success) {
    throw new DataIntegrityError(UNREADABLE, { cause: graph.error })
  }
  return graph.data
}

function toWorkflow(row: WorkflowRow): WorkflowRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    graph: parseGraph(row.graph),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toRun(row: RunRow): WorkflowRunRecord {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    ownerId: row.owner_id,
    graph: parseGraph(row.graph),
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
      graph: JSON.stringify(workflow.graph),
      revision: workflow.revision,
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

  async update(
    id: string,
    expectedRevision: number,
    changes: Pick<WorkflowRecord, 'name' | 'graph'>,
    now: string,
  ): Promise<WorkflowRecord> {
    const changed = await this.#database('workflows')
      .where({ id, revision: expectedRevision })
      .update({
        name: changes.name,
        graph: JSON.stringify(changes.graph),
        revision: expectedRevision + 1,
        updated_at: now,
      })
    if (changed === 0) {
      const exists = await this.findById(id)
      if (exists === null) throw new NotFoundError(MISSING)
      throw new ConflictError(STALE_WORKFLOW_MESSAGE)
    }
    const updated = await this.findById(id)
    if (updated === null) throw new NotFoundError(MISSING)
    return updated
  }

  async delete(id: string): Promise<void> {
    await this.#database('workflows').where({ id }).delete()
  }

  async insertRun(run: WorkflowRunRecord): Promise<void> {
    await this.#database('workflow_runs').insert({
      id: run.id,
      workflow_id: run.workflowId,
      owner_id: run.ownerId,
      graph: JSON.stringify(run.graph),
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
