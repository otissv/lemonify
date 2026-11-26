import { describe, expect, it } from 'vitest'

import { WorkerPool } from '@/features/ai/ai-tools'

import { JOB_PRIORITY, JobKind, JobState } from '../../jobs/job-types.ts'
import type { JobRecord, JobResult } from '../../jobs/job-types.ts'
import type { JobDao } from '../job-dao.ts'

export type JobFixture = {
  dao: JobDao
  seedUser(id: string): Promise<void>
  /** Creates a Document the Jobs can belong to. */
  seedDocument(id: string, ownerId: string): Promise<void>
  close(): Promise<void>
}

const T0 = '2026-01-01T00:00:00.000Z'
const T1 = '2026-01-01T00:00:01.000Z'
const T2 = '2026-01-01T00:00:02.000Z'
const T3 = '2026-01-02T00:00:00.000Z'

export function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job-1',
    kind: JobKind.Preview,
    ownerId: 'ann',
    pool: WorkerPool.Cpu,
    priority: JOB_PRIORITY[JobKind.Export],
    groupKey: 'doc-1',
    documentId: 'doc-1',
    workflowRunId: null,
    state: JobState.Waiting,
    progress: 0,
    payload: { kind: JobKind.Preview, documentId: 'doc-1', revision: 0 },
    result: null,
    error: null,
    claimedBy: null,
    cancelRequested: false,
    createdAt: T0,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  }
}

const DONE_RESULT: JobResult = {
  kind: JobKind.Preview,
  key: 'a'.repeat(64),
  width: 8,
  height: 6,
  pendingStepIds: [],
  waitingLayerIds: [],
  problems: [],
}

async function prepare(create: () => Promise<JobFixture>): Promise<JobFixture> {
  const fixture = await create()
  await fixture.seedUser('ann')
  await fixture.seedUser('bob')
  await fixture.seedDocument('doc-1', 'ann')
  await fixture.seedDocument('doc-2', 'ann')
  return fixture
}

function documentJob(
  id: string,
  documentId: string,
  overrides: Partial<JobRecord> = {},
) {
  return job({
    id,
    documentId,
    groupKey: documentId,
    payload: { kind: JobKind.Preview, documentId, revision: 0 },
    ...overrides,
  })
}

export function jobDaoContract(
  implementation: string,
  create: () => Promise<JobFixture>,
): void {
  describe(`JobDao contract: ${implementation}`, () => {
    it('stores Jobs and finds one by id', async () => {
      const { dao, close } = await prepare(create)
      await dao.enqueue([job(), documentJob('job-2', 'doc-2')])
      expect(await dao.findById('job-1')).toEqual(job())
      expect(await dao.findById('missing')).toBeNull()
      await close()
    })

    it('queues several Jobs together or none', async () => {
      const { dao, close } = await prepare(create)
      await expect(
        dao.enqueue([documentJob('a', 'doc-1'), documentJob('a', 'doc-1')]),
      ).rejects.toThrow()
      expect(await dao.findById('a')).toBeNull()
      await close()
    })

    it('lists waiting Jobs of a pool by priority, then age', async () => {
      const { dao, close } = await prepare(create)
      await dao.enqueue([
        documentJob('late', 'doc-1', { createdAt: T2 }),
        documentJob('early', 'doc-1', { createdAt: T0 }),
        documentJob('urgent', 'doc-1', { createdAt: T3, priority: 0 }),
        documentJob('slow', 'doc-1', { createdAt: T0, priority: 5 }),
        documentJob('gpu', 'doc-1', { pool: WorkerPool.Gpu }),
      ])
      const ids = (await dao.listWaiting(WorkerPool.Cpu)).map(({ id }) => id)
      expect(ids).toEqual(['urgent', 'early', 'late', 'slow'])
      await close()
    })

    it('claims a waiting Job once', async () => {
      const { dao, close } = await prepare(create)
      await dao.enqueue([job()])
      expect(await dao.claim('job-1', '10:1', T1)).toBe(true)
      expect(await dao.claim('job-1', '11:2', T2)).toBe(false)
      const running = await dao.findById('job-1')
      expect(running).toMatchObject({
        state: JobState.Running,
        claimedBy: '10:1',
        startedAt: T1,
      })
      expect(await dao.listWaiting(WorkerPool.Cpu)).toEqual([])
      expect(await dao.listRunning()).toHaveLength(1)
      await close()
    })

    it('counts running Jobs per group in a pool', async () => {
      const { dao, close } = await prepare(create)
      await dao.enqueue([
        documentJob('a', 'doc-1'),
        documentJob('b', 'doc-1'),
        documentJob('c', 'doc-2'),
        documentJob('d', 'doc-2', { pool: WorkerPool.Gpu }),
        documentJob('e', 'doc-2'),
      ])
      for (const id of ['a', 'b', 'c', 'd']) await dao.claim(id, 'p', T1)
      const counts = await dao.countRunningByGroup(WorkerPool.Cpu)
      expect(Object.fromEntries(counts)).toEqual({ 'doc-1': 2, 'doc-2': 1 })
      await close()
    })

    it('counts the waiting Jobs of one User', async () => {
      const { dao, close } = await prepare(create)
      await dao.enqueue([
        documentJob('a', 'doc-1'),
        documentJob('b', 'doc-1'),
        documentJob('c', 'doc-1'),
      ])
      await dao.claim('c', 'p', T1)
      expect(await dao.countWaitingForOwner('ann')).toBe(2)
      expect(await dao.countWaitingForOwner('bob')).toBe(0)
      await close()
    })

    it('records progress only while running', async () => {
      const { dao, close } = await prepare(create)
      await dao.enqueue([job()])
      await dao.setProgress('job-1', 0.5)
      expect((await dao.findById('job-1'))?.progress).toBe(0)
      await dao.claim('job-1', 'p', T1)
      await dao.setProgress('job-1', 0.5)
      expect((await dao.findById('job-1'))?.progress).toBe(0.5)
      await close()
    })

    it('cancels a waiting Job at once and asks a running one to stop', async () => {
      const { dao, close } = await prepare(create)
      await dao.enqueue([documentJob('w', 'doc-1'), documentJob('r', 'doc-1')])
      await dao.claim('r', 'p', T1)
      expect(await dao.requestCancel('w', T2)).toBe('cancelled')
      expect(await dao.findById('w')).toMatchObject({
        state: JobState.Cancelled,
        finishedAt: T2,
      })
      expect(await dao.requestCancel('r', T2)).toBe('requested')
      expect(await dao.findById('r')).toMatchObject({
        state: JobState.Running,
        cancelRequested: true,
      })
      expect(await dao.requestCancel('w', T3)).toBe('finished')
      expect(await dao.requestCancel('missing', T3)).toBe('finished')
      await close()
    })

    it('does not claim a Job that was cancelled', async () => {
      const { dao, close } = await prepare(create)
      await dao.enqueue([job()])
      await dao.requestCancel('job-1', T1)
      expect(await dao.claim('job-1', 'p', T2)).toBe(false)
      await close()
    })

    it('finishes a running Job with its result and queues the next Jobs with it', async () => {
      const { dao, close } = await prepare(create)
      await dao.enqueue([job()])
      await dao.claim('job-1', 'p', T1)
      const follower = documentJob('next', 'doc-1', { createdAt: T2 })
      const finished = await dao.finish(
        'job-1',
        { state: JobState.Done, result: DONE_RESULT },
        [follower],
        T2,
      )
      expect(finished).toBe(true)
      expect(await dao.findById('job-1')).toMatchObject({
        state: JobState.Done,
        result: DONE_RESULT,
        progress: 1,
        finishedAt: T2,
      })
      expect(await dao.findById('next')).toEqual(follower)
      await close()
    })

    it('ends a Job that was asked to cancel as cancelled, keeping its result and queueing no followers', async () => {
      const { dao, close } = await prepare(create)
      await dao.enqueue([job()])
      await dao.claim('job-1', 'p', T1)
      await dao.requestCancel('job-1', T1)
      const follower = documentJob('next', 'doc-1')
      const finished = await dao.finish(
        'job-1',
        { state: JobState.Done, result: DONE_RESULT },
        [follower],
        T2,
      )
      expect(finished).toBe(true)
      expect(await dao.findById('next')).toBeNull()
      expect(await dao.findById('job-1')).toMatchObject({
        state: JobState.Cancelled,
        result: DONE_RESULT,
      })
      await close()
    })

    it('records a failure and a cancellation', async () => {
      const { dao, close } = await prepare(create)
      await dao.enqueue([documentJob('f', 'doc-1'), documentJob('c', 'doc-1')])
      await dao.claim('f', 'p', T1)
      await dao.claim('c', 'p', T1)
      await dao.finish(
        'f',
        { state: JobState.Failed, error: 'It broke.' },
        [],
        T2,
      )
      await dao.finish('c', { state: JobState.Cancelled }, [], T2)
      expect(await dao.findById('f')).toMatchObject({
        state: JobState.Failed,
        error: 'It broke.',
      })
      expect(await dao.findById('c')).toMatchObject({
        state: JobState.Cancelled,
      })
      await close()
    })

    it('refuses to finish a Job that is not running, and queues nothing', async () => {
      const { dao, close } = await prepare(create)
      await dao.enqueue([job()])
      const follower = documentJob('next', 'doc-1')
      const finished = await dao.finish(
        'job-1',
        { state: JobState.Done, result: DONE_RESULT },
        [follower],
        T2,
      )
      expect(finished).toBe(false)
      expect(await dao.findById('next')).toBeNull()
      expect((await dao.findById('job-1'))?.state).toBe(JobState.Waiting)
      await close()
    })

    it('lists a User’s Jobs newest first with filters', async () => {
      const { dao, close } = await prepare(create)
      await dao.enqueue([
        documentJob('a', 'doc-1', { createdAt: T0 }),
        documentJob('b', 'doc-2', { createdAt: T1 }),
        documentJob('c', 'doc-1', { createdAt: T2, kind: JobKind.Export }),
      ])
      await dao.claim('a', 'p', T1)
      const all = (await dao.list('ann', {})).map(({ id }) => id)
      expect(all).toEqual(['c', 'b', 'a'])
      expect(
        (await dao.list('ann', { documentId: 'doc-1' })).map(({ id }) => id),
      ).toEqual(['c', 'a'])
      expect(
        (await dao.list('ann', { state: [JobState.Running] })).map(
          ({ id }) => id,
        ),
      ).toEqual(['a'])
      expect(
        (await dao.list('ann', { kind: JobKind.Export })).map(({ id }) => id),
      ).toEqual(['c'])
      expect((await dao.list('ann', { limit: 1 })).map(({ id }) => id)).toEqual(
        ['c'],
      )
      expect(await dao.list('bob', {})).toEqual([])
      await close()
    })

    it('lists the active Jobs of a Document by kind', async () => {
      const { dao, close } = await prepare(create)
      await dao.enqueue([
        documentJob('a', 'doc-1'),
        documentJob('b', 'doc-1', { kind: JobKind.Export }),
        documentJob('c', 'doc-2'),
        documentJob('d', 'doc-1'),
      ])
      await dao.claim('d', 'p', T1)
      await dao.finish('d', { state: JobState.Cancelled }, [], T2)
      const previews = await dao.listActive({
        documentId: 'doc-1',
        kinds: [JobKind.Preview],
      })
      expect(previews.map(({ id }) => id)).toEqual(['a'])
      expect(await dao.listActive({ documentId: 'doc-1' })).toHaveLength(2)
      await close()
    })

    it('deletes Jobs that finished before a time and keeps the rest', async () => {
      const { dao, close } = await prepare(create)
      await dao.enqueue([
        documentJob('old', 'doc-1'),
        documentJob('new', 'doc-1'),
        documentJob('waiting', 'doc-1'),
      ])
      await dao.claim('old', 'p', T1)
      await dao.claim('new', 'p', T1)
      await dao.finish('old', { state: JobState.Cancelled }, [], T1)
      await dao.finish('new', { state: JobState.Cancelled }, [], T3)
      expect(await dao.deleteFinishedBefore(T2)).toBe(1)
      expect(await dao.findById('old')).toBeNull()
      expect(await dao.findById('new')).not.toBeNull()
      expect(await dao.findById('waiting')).not.toBeNull()
      await close()
    })
  })
}
