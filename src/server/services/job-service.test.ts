import { describe, expect, it } from 'vitest'

import { WorkerPool } from '@/features/ai/ai-tools'

import { MemoryJobDao } from '../dao/memory/job-dao.ts'
import { JobFailedError, LimitError, NotFoundError } from '../errors.ts'
import { JobKind, JobState } from '../jobs/job-types.ts'
import type { NewJob } from './job-service.ts'
import { JobService } from './job-service.ts'
import { FixedClock, SequenceIds } from '../testing/fakes.ts'

const ANN = { userId: 'ann', name: 'ann' }
const BOB = { userId: 'bob', name: 'bob' }
const PREVIEW: NewJob = {
  kind: JobKind.Preview,
  payload: { kind: JobKind.Preview, documentId: 'doc-1', revision: 0 },
  pool: WorkerPool.Cpu,
  groupKey: 'doc-1',
  documentId: 'doc-1',
}

function setup(max = 3) {
  const jobs = new MemoryJobDao()
  const clock = new FixedClock()
  let queued = 0
  const service = new JobService({
    jobs,
    clock,
    ids: new SequenceIds('job'),
    maxWaitingPerUser: max,
    onQueued: () => {
      queued += 1
    },
    followIntervalMs: 5,
  })
  return { jobs, clock, service, queuedCount: () => queued }
}

describe('JobService', () => {
  it('queues Jobs with the kind’s priority and tells the scheduler', async () => {
    const { service, queuedCount } = setup()
    const [first] = await service.enqueue(ANN, [PREVIEW])
    expect(first).toMatchObject({
      id: 'job-1',
      ownerId: 'ann',
      priority: 0,
      state: JobState.Waiting,
      groupKey: 'doc-1',
    })
    expect(queuedCount()).toBe(1)
  })

  it('refuses to queue past the User’s waiting limit', async () => {
    const { service } = setup(2)
    await service.enqueue(ANN, [PREVIEW, PREVIEW])
    await expect(service.enqueue(ANN, [PREVIEW])).rejects.toBeInstanceOf(
      LimitError,
    )
    await expect(service.enqueue(BOB, [PREVIEW])).resolves.toHaveLength(1)
  })

  it('shows a Job only to its owner', async () => {
    const { service } = setup()
    const [job] = await service.enqueue(ANN, [PREVIEW])
    const id = job?.id ?? ''
    expect((await service.get(ANN, id)).state).toBe(JobState.Waiting)
    await expect(service.get(BOB, id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(service.get(ANN, 'missing')).rejects.toBeInstanceOf(
      NotFoundError,
    )
    expect(await service.list(BOB)).toEqual([])
    expect(await service.list(ANN)).toHaveLength(1)
  })

  it('does not reveal internals in a view', async () => {
    const { service } = setup()
    const [job] = await service.enqueue(ANN, [PREVIEW])
    const view = await service.get(ANN, job?.id ?? '')
    expect(Object.keys(view)).not.toContain('payload')
    expect(Object.keys(view)).not.toContain('claimedBy')
    expect(Object.keys(view)).not.toContain('ownerId')
  })

  it('cancels a waiting Job, and only its owner may', async () => {
    const { service } = setup()
    const [job] = await service.enqueue(ANN, [PREVIEW])
    const id = job?.id ?? ''
    await expect(service.cancel(BOB, id)).rejects.toBeInstanceOf(NotFoundError)
    expect((await service.cancel(ANN, id)).state).toBe(JobState.Cancelled)
  })

  it('follows a Job until it ends, yielding each change once', async () => {
    const { service, jobs } = setup()
    const [job] = await service.enqueue(ANN, [PREVIEW])
    const id = job?.id ?? ''
    const seen: string[] = []
    const following = (async () => {
      for await (const views of service.follow(ANN, [id])) {
        seen.push(`${views[0]?.state}:${views[0]?.progress}`)
      }
    })()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await jobs.claim(id, 'p', '2026-01-01T00:00:01.000Z')
    await new Promise((resolve) => setTimeout(resolve, 20))
    await jobs.setProgress(id, 0.5)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await jobs.finish(
      id,
      { state: JobState.Cancelled },
      [],
      '2026-01-01T00:00:02.000Z',
    )
    await following
    expect(seen).toEqual([
      'waiting:0',
      'running:0',
      'running:0.5',
      'cancelled:0.5',
    ])
  })

  it('stops following when asked', async () => {
    const { service } = setup()
    const [job] = await service.enqueue(ANN, [PREVIEW])
    const controller = new AbortController()
    const received: number[] = []
    const following = (async () => {
      for await (const views of service.follow(
        ANN,
        [job?.id ?? ''],
        controller.signal,
      )) {
        received.push(views.length)
      }
    })()
    await new Promise((resolve) => setTimeout(resolve, 20))
    controller.abort()
    await following
    expect(received).toEqual([1])
  })

  it('returns the finished Job from waitFor', async () => {
    const { service, jobs } = setup()
    const [job] = await service.enqueue(ANN, [PREVIEW])
    const id = job?.id ?? ''
    const waiting = service.waitFor(ANN, id)
    await jobs.claim(id, 'p', '2026-01-01T00:00:01.000Z')
    await jobs.finish(
      id,
      {
        state: JobState.Done,
        result: {
          kind: JobKind.Preview,
          key: 'k',
          width: 8,
          height: 6,
          pendingStepIds: [],
          problems: [],
        },
      },
      [],
      '2026-01-01T00:00:02.000Z',
    )
    expect((await waiting).state).toBe(JobState.Done)
  })

  it('fails waitFor with the Job’s own message when it failed or was cancelled', async () => {
    const { service, jobs } = setup()
    const [failing, cancelled] = await service.enqueue(ANN, [PREVIEW, PREVIEW])
    await jobs.claim(failing?.id ?? '', 'p', '2026-01-01T00:00:01.000Z')
    await jobs.finish(
      failing?.id ?? '',
      { state: JobState.Failed, error: 'The GPU ran out of memory.' },
      [],
      '2026-01-01T00:00:02.000Z',
    )
    await expect(service.waitFor(ANN, failing?.id ?? '')).rejects.toThrow(
      'The GPU ran out of memory.',
    )
    await service.cancel(ANN, cancelled?.id ?? '')
    await expect(
      service.waitFor(ANN, cancelled?.id ?? ''),
    ).rejects.toBeInstanceOf(JobFailedError)
  })

  it('deletes finished Jobs older than the retention period', async () => {
    const { service, jobs, clock } = setup()
    const [old, recent] = await service.enqueue(ANN, [PREVIEW, PREVIEW])
    await service.cancel(ANN, old?.id ?? '')
    clock.advance(40 * 86_400_000)
    await service.cancel(ANN, recent?.id ?? '')
    expect(await service.sweepFinished(30)).toBe(1)
    expect(await jobs.findById(old?.id ?? '')).toBeNull()
    expect(await jobs.findById(recent?.id ?? '')).not.toBeNull()
  })
})
