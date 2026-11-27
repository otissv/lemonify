import type { Knex } from 'knex'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { WorkerPool } from '@/features/ai/ai-tools'
import type { HistoryPatch } from '@/features/pipeline/document-change'
import { createSharpStep } from '@/features/pipeline/pipeline'
import type { WorkflowHistoryPatch } from '@/features/workflows/workflow-change'
import { createWorkflow } from '@/features/workflows/workflow'
import type { WorkflowDefinition } from '@/features/workflows/workflow'
import { pipelineOf } from '@/test/pipelines'

import { ConflictError } from '../../errors'
import { JobKind, JobState } from '../../jobs/job-types'
import { createTestDatabase, insertTestUser } from '../../testing/test-database'
import type { TestDatabase } from '../../testing/test-database'
import { job } from '../contract/job-dao.contract'
import { documentRecord, source } from '../contract/library-dao.contract'
import { workflow } from '../contract/workflow-dao.contract'
import { PostgresDocumentDao } from './document-dao'
import { PostgresJobDao } from './job-dao'
import { PostgresSourceDao } from './source-dao'
import { PostgresWorkflowDao } from './workflow-dao'

const T1 = '2026-01-02T00:00:00.000Z'
const T2 = '2026-01-03T00:00:00.000Z'
const STEP_ID = '00000000-0000-4000-8000-000000000001'
const WAIT_FOR_WAITERS_MS = 2000
const POLL_MS = 10

let test: TestDatabase

beforeEach(async () => {
  test = await createTestDatabase()
  await insertTestUser(test.database, 'ann')
})

afterEach(async () => {
  await test.close()
})

/**
 * Waits until `count` statements are waiting for a lock, so the test knows
 * both operations are inside their transactions before the holder lets go.
 * It gives up after a while instead of failing: without the row lock the
 * operations never wait, and the assertions after it are what fail.
 */
async function lockWaiters(database: Knex, count: number): Promise<void> {
  const deadline = Date.now() + WAIT_FOR_WAITERS_MS
  while (Date.now() < deadline) {
    const row = await database('pg_locks')
      .where({ granted: false })
      .count({ waiting: '*' })
      .first()
    if (Number(row?.waiting ?? 0) >= count) return
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

/** Holds the row's lock in a transaction of its own until `release` is called. */
async function holdRow(table: string, id: string): Promise<Knex.Transaction> {
  const holder = await test.database.transaction()
  await holder(table).where({ id }).forUpdate()
  return holder
}

function outcomes(results: PromiseSettledResult<unknown>[]): {
  saved: number
  conflicts: number
  others: unknown[]
} {
  let saved = 0
  let conflicts = 0
  const others: unknown[] = []
  for (const result of results) {
    if (result.status === 'fulfilled') saved += 1
    else if (result.reason instanceof ConflictError) conflicts += 1
    else others.push(result.reason)
  }
  return { saved, conflicts, others }
}

const STEP = { ...createSharpStep('blur'), id: STEP_ID }
const DOCUMENT_PATCH: HistoryPatch = {
  forward: { type: 'add-step', step: STEP, index: 0 },
  inverse: { type: 'remove-step', stepId: STEP_ID },
}

function documentChange(expectedRevision: number, now: string) {
  return {
    id: 'doc-1',
    expectedRevision,
    pipeline: pipelineOf(STEP),
    operandSourceIds: ['src-1'],
    patch: DOCUMENT_PATCH,
    maxEntries: 100,
    now,
  }
}

async function seedDocument(): Promise<PostgresDocumentDao> {
  await new PostgresSourceDao(test.database).insert(source())
  const documents = new PostgresDocumentDao(test.database)
  await documents.insert(documentRecord(), ['src-1'])
  return documents
}

describe('a document changed by two tabs at once', () => {
  it('saves one edit and gives the other the stale document conflict, not a database error', async () => {
    const documents = await seedDocument()
    const holder = await holdRow('documents', 'doc-1')
    const both = Promise.allSettled([
      documents.applyChange(documentChange(0, T1)),
      documents.applyChange(documentChange(0, T2)),
    ])
    await lockWaiters(test.database, 2)
    await holder.commit()
    expect(outcomes(await both)).toEqual({ saved: 1, conflicts: 1, others: [] })
    expect(await documents.findById('doc-1')).toMatchObject({
      revision: 1,
      historyCursor: 1,
    })
  })

  it('saves an undo or an edit of the same revision, never both, so the history matches the pipeline', async () => {
    const documents = await seedDocument()
    await documents.applyChange(documentChange(0, T1))
    const holder = await holdRow('documents', 'doc-1')
    const both = Promise.allSettled([
      documents.moveCursor({
        id: 'doc-1',
        expectedRevision: 1,
        pipeline: pipelineOf(),
        operandSourceIds: ['src-1'],
        cursor: 0,
        now: T2,
      }),
      documents.applyChange(documentChange(1, T2)),
    ])
    await lockWaiters(test.database, 2)
    await holder.commit()
    expect(outcomes(await both)).toEqual({ saved: 1, conflicts: 1, others: [] })
    const saved = await documents.findById('doc-1')
    expect(saved?.revision).toBe(2)
    const entry = await documents.findEntry('doc-1', 1)
    if (saved?.historyCursor === 0) {
      expect(saved.pipeline).toEqual(pipelineOf())
      expect(entry).toBeNull()
    } else {
      expect(saved?.historyCursor).toBe(2)
      expect(entry?.patch).toEqual(DOCUMENT_PATCH)
    }
  })
})

function definitionWith(inputs: string[]): WorkflowDefinition {
  const { pipeline, output, canvasSize } = createWorkflow('Test')
  return { pipeline, inputs, output, canvasSize }
}

const WORKFLOW_PATCH: WorkflowHistoryPatch = {
  forward: { type: 'set-inputs', sourceIds: ['a'] },
  inverse: { type: 'set-inputs', sourceIds: [] },
}

function workflowChange(expectedRevision: number, now: string) {
  return {
    id: 'wf-1',
    expectedRevision,
    definition: definitionWith(['a']),
    patch: WORKFLOW_PATCH,
    maxEntries: 100,
    now,
  }
}

describe('a workflow changed by two tabs at once', () => {
  it('saves one edit and gives the other the stale workflow conflict', async () => {
    const workflows = new PostgresWorkflowDao(test.database)
    await workflows.insert(workflow())
    const holder = await holdRow('workflows', 'wf-1')
    const both = Promise.allSettled([
      workflows.applyChange(workflowChange(0, T1)),
      workflows.applyChange(workflowChange(0, T2)),
    ])
    await lockWaiters(test.database, 2)
    await holder.commit()
    expect(outcomes(await both)).toEqual({ saved: 1, conflicts: 1, others: [] })
    expect((await workflows.findById('wf-1'))?.revision).toBe(1)
  })

  it('saves an undo or an edit of the same revision, never both', async () => {
    const workflows = new PostgresWorkflowDao(test.database)
    await workflows.insert(workflow())
    await workflows.applyChange(workflowChange(0, T1))
    const holder = await holdRow('workflows', 'wf-1')
    const both = Promise.allSettled([
      workflows.moveCursor({
        id: 'wf-1',
        expectedRevision: 1,
        definition: definitionWith([]),
        cursor: 0,
        now: T2,
      }),
      workflows.applyChange(workflowChange(1, T2)),
    ])
    await lockWaiters(test.database, 2)
    await holder.commit()
    expect(outcomes(await both)).toEqual({ saved: 1, conflicts: 1, others: [] })
    expect((await workflows.findById('wf-1'))?.revision).toBe(2)
  })
})

describe('a job cancelled while it finishes', () => {
  it('queues none of its next jobs', async () => {
    await seedDocument()
    const jobs = new PostgresJobDao(test.database)
    await jobs.enqueue([job()])
    expect(await jobs.claim('job-1', 'worker-1', T1)).toBe(true)
    const holder = await holdRow('jobs', 'job-1')
    const cancel = jobs.requestCancel('job-1', T2)
    await lockWaiters(test.database, 1)
    const finish = jobs.finish(
      'job-1',
      { state: JobState.Failed, error: 'It broke.' },
      [job({ id: 'next', pool: WorkerPool.Cpu, kind: JobKind.Preview })],
      T2,
    )
    await lockWaiters(test.database, 2)
    await holder.commit()
    expect(await cancel).toBe('requested')
    expect(await finish).toBe(true)
    expect(await jobs.findById('next')).toBeNull()
  })
})
