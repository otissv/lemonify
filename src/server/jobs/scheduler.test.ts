import { afterEach, describe, expect, it } from 'vitest'

import { AiToolId, WorkerPool } from '@/features/ai/ai-tools'

import { job } from '../dao/contract/job-dao.contract.ts'
import { MemoryJobDao } from '../dao/memory/job-dao.ts'
import { MemoryLogger } from '../http/logger.ts'
import { systemClock } from '../domain/clock.ts'
import { FixedClock } from '../testing/fakes.ts'
import { StaleJobError } from './job-handler.ts'
import type { JobHandler, JobItem, JobReport } from './job-handler.ts'
import { JobKind, JobState } from './job-types.ts'
import type { JobOutcome, JobRecord } from './job-types.ts'
import { formatClaim } from './process-identity.ts'
import { Scheduler } from './scheduler.ts'
import type { SchedulerOptions } from './scheduler.ts'

const ME = { pid: 1000, startedAt: '2026-01-01T00:00:00.000Z' }
const DONE_PREVIEW: JobOutcome = {
  state: JobState.Done,
  result: {
    kind: JobKind.Preview,
    key: 'a'.repeat(64),
    pendingStepIds: [],
    problems: [],
  },
}

async function until(check: () => Promise<boolean> | boolean): Promise<void> {
  const limit = Date.now() + 3000
  while (Date.now() < limit) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for the condition.')
}

function previewJob(
  id: string,
  group: string,
  overrides: Partial<JobRecord> = {},
) {
  return job({
    id,
    kind: JobKind.Preview,
    groupKey: group,
    documentId: group,
    priority: 0,
    payload: { kind: JobKind.Preview, documentId: group, revision: 0 },
    ...overrides,
  })
}

function aiJob(
  id: string,
  batchKey: string,
  overrides: Partial<JobRecord> = {},
) {
  return job({
    id,
    kind: JobKind.AiStep,
    pool: WorkerPool.Gpu,
    groupKey: `doc-${id}`,
    documentId: `doc-${id}`,
    payload: {
      kind: JobKind.AiStep,
      documentId: `doc-${id}`,
      revision: 0,
      stepId: 's',
      tool: AiToolId.Upscale,
      batchKey,
    },
    ...overrides,
  })
}

describe('Scheduler', () => {
  const stoppers: Array<() => Promise<void>> = []
  const logger = new MemoryLogger()

  afterEach(async () => {
    for (const stop of stoppers.splice(0)) await stop()
  })

  function build(
    jobs: MemoryJobDao,
    handlers: SchedulerOptions['handlers'],
    overrides: Partial<SchedulerOptions> = {},
  ): Scheduler {
    const scheduler = new Scheduler({
      jobs,
      handlers,
      clock: new FixedClock(),
      logger,
      slots: { [WorkerPool.Cpu]: 2, [WorkerPool.Gpu]: 1 },
      groupSharePercent: 50,
      batchLimit: () => 8,
      identity: ME,
      pollMs: 20,
      cancelPollMs: 10,
      progressSaveMs: 0,
      batchWindowMs: 0,
      ...overrides,
    })
    stoppers.push(() => scheduler.stop({ abort: true }))
    return scheduler
  }

  function finishing(
    run: (item: JobItem) => Promise<void> | void = () => {},
  ): JobHandler {
    return {
      async run(items): Promise<JobReport[]> {
        const reports: JobReport[] = []
        for (const item of items) {
          await run(item)
          reports.push({ outcome: DONE_PREVIEW })
        }
        return reports
      },
    }
  }

  it('runs a waiting Job to completion and records its result', async () => {
    const jobs = new MemoryJobDao()
    await jobs.enqueue([previewJob('a', 'doc-1')])
    const scheduler = build(jobs, { [JobKind.Preview]: finishing() })
    await scheduler.start()
    await until(async () => (await jobs.findById('a'))?.state === JobState.Done)
    const done = await jobs.findById('a')
    expect(done?.result).toEqual(DONE_PREVIEW.result)
    expect(done?.claimedBy).toBe(formatClaim(ME))
  })

  it('runs no more Jobs of a pool at once than it has slots', async () => {
    const jobs = new MemoryJobDao()
    await jobs.enqueue(
      ['a', 'b', 'c', 'd', 'e'].map((id) => previewJob(id, `doc-${id}`)),
    )
    let concurrent = 0
    let peak = 0
    const scheduler = build(jobs, {
      [JobKind.Preview]: finishing(async () => {
        concurrent += 1
        peak = Math.max(peak, concurrent)
        await new Promise((resolve) => setTimeout(resolve, 20))
        concurrent -= 1
      }),
    })
    await scheduler.start()
    await until(
      async () =>
        (await jobs.listWaiting(WorkerPool.Cpu)).length === 0 &&
        concurrent === 0 &&
        (await jobs.listRunning()).length === 0,
    )
    expect(peak).toBe(2)
  })

  it('serves a second Document before the first one’s long queue', async () => {
    const jobs = new MemoryJobDao()
    const times = (n: number) => `2026-01-01T00:00:0${n}.000Z`
    await jobs.enqueue([
      previewJob('a1', 'doc-a', { createdAt: times(0) }),
      previewJob('a2', 'doc-a', { createdAt: times(1) }),
      previewJob('a3', 'doc-a', { createdAt: times(2) }),
      previewJob('b1', 'doc-b', { createdAt: times(3) }),
    ])
    const order: string[] = []
    const scheduler = build(
      jobs,
      {
        [JobKind.Preview]: finishing(({ job: started }) => {
          order.push(started.id)
        }),
      },
      { slots: { [WorkerPool.Cpu]: 1, [WorkerPool.Gpu]: 1 } },
    )
    await scheduler.start()
    await until(() => order.length === 4)
    expect(order.indexOf('b1')).toBeLessThan(order.indexOf('a3'))
  })

  it('runs a preview before workflow work that was queued first', async () => {
    const jobs = new MemoryJobDao()
    await jobs.enqueue([
      job({
        id: 'run',
        kind: JobKind.RunItem,
        priority: 3,
        groupKey: 'run-1',
        documentId: null,
        workflowRunId: null,
        payload: {
          kind: JobKind.RunItem,
          workflowRunId: 'run-1',
          sourceId: 's',
          segment: 0,
        },
      }),
      previewJob('preview', 'doc-1', { createdAt: '2026-01-01T00:00:09.000Z' }),
    ])
    const order: string[] = []
    const handler = finishing(({ job: started }) => {
      order.push(started.id)
    })
    const scheduler = build(
      jobs,
      { [JobKind.Preview]: handler, [JobKind.RunItem]: handler },
      { slots: { [WorkerPool.Cpu]: 1, [WorkerPool.Gpu]: 1 } },
    )
    await scheduler.start()
    await until(() => order.length === 2)
    expect(order).toEqual(['preview', 'run'])
  })

  it('does not let a busy CPU pool delay the GPU pool', async () => {
    const jobs = new MemoryJobDao()
    await jobs.enqueue([
      previewJob('cpu1', 'doc-1'),
      previewJob('cpu2', 'doc-2'),
      aiJob('gpu', 'k'),
    ])
    let release: () => void = () => {}
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const scheduler = build(jobs, {
      [JobKind.Preview]: finishing(() => hold),
      [JobKind.AiStep]: finishing(),
    })
    await scheduler.start()
    await until(
      async () => (await jobs.findById('gpu'))?.state === JobState.Done,
    )
    expect((await jobs.findById('cpu1'))?.state).toBe(JobState.Running)
    release()
  })

  it('runs waiting GPU Jobs with the same batch key together, up to the cap', async () => {
    const jobs = new MemoryJobDao()
    const times = (n: number) => `2026-01-01T00:00:0${n}.000Z`
    await jobs.enqueue([
      aiJob('a', 'm:4', { createdAt: times(0) }),
      aiJob('b', 'm:4', { createdAt: times(1) }),
      aiJob('c', 'm:2', { createdAt: times(2) }),
      aiJob('d', 'm:4', { createdAt: times(3) }),
    ])
    const batches: string[][] = []
    const handler: JobHandler = {
      async run(items) {
        batches.push(items.map(({ job: item }) => item.id))
        return items.map(() => ({ outcome: DONE_PREVIEW }))
      },
    }
    const scheduler = build(
      jobs,
      { [JobKind.AiStep]: handler },
      {
        batchLimit: () => 2,
      },
    )
    await scheduler.start()
    await until(() => batches.flat().length === 4)
    expect(batches).toEqual([['a', 'b'], ['c'], ['d']])
  })

  it('holds a Job that can batch for a short window so companions can join it', async () => {
    const jobs = new MemoryJobDao()
    const fresh = () => new Date().toISOString()
    await jobs.enqueue([aiJob('a', 'm:4', { createdAt: fresh() })])
    const batches: string[][] = []
    const handler: JobHandler = {
      async run(items) {
        batches.push(items.map(({ job: item }) => item.id))
        return items.map(() => ({ outcome: DONE_PREVIEW }))
      },
    }
    const scheduler = build(
      jobs,
      { [JobKind.AiStep]: handler },
      {
        clock: systemClock,
        batchWindowMs: 150,
      },
    )
    await scheduler.start()
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(batches).toEqual([])
    await jobs.enqueue([aiJob('b', 'm:4', { createdAt: fresh() })])
    await until(() => batches.flat().length === 2)
    expect(batches).toEqual([['a', 'b']])
  })

  it('starts a lone batchable Job once the window has passed', async () => {
    const jobs = new MemoryJobDao()
    await jobs.enqueue([
      aiJob('a', 'm:4', { createdAt: new Date().toISOString() }),
    ])
    const handler: JobHandler = {
      async run(items) {
        return items.map(() => ({ outcome: DONE_PREVIEW }))
      },
    }
    const scheduler = build(
      jobs,
      { [JobKind.AiStep]: handler },
      {
        clock: systemClock,
        batchWindowMs: 80,
      },
    )
    await scheduler.start()
    await until(async () => (await jobs.findById('a'))?.state === JobState.Done)
  })

  it('fails every Job of a call when the handler throws, with a plain message', async () => {
    const jobs = new MemoryJobDao()
    await jobs.enqueue([previewJob('a', 'doc-1')])
    const scheduler = build(jobs, {
      [JobKind.Preview]: {
        async run() {
          throw new Error('ENOENT /secret/path/file')
        },
      },
    })
    await scheduler.start()
    await until(
      async () => (await jobs.findById('a'))?.state === JobState.Failed,
    )
    const failed = await jobs.findById('a')
    expect(failed?.error).toBe('The job failed unexpectedly.')
    expect(JSON.stringify(logger.lines)).toContain('ENOENT')
  })

  it('cancels a Job that its handler reports as stale', async () => {
    const jobs = new MemoryJobDao()
    await jobs.enqueue([previewJob('a', 'doc-1')])
    const scheduler = build(jobs, {
      [JobKind.Preview]: {
        async run() {
          throw new StaleJobError()
        },
      },
    })
    await scheduler.start()
    await until(
      async () => (await jobs.findById('a'))?.state === JobState.Cancelled,
    )
  })

  it('leaves a Job alone when this process has no handler for its kind', async () => {
    const jobs = new MemoryJobDao()
    await jobs.enqueue([previewJob('a', 'doc-1')])
    const scheduler = build(jobs, {})
    await scheduler.start()
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect((await jobs.findById('a'))?.state).toBe(JobState.Waiting)
  })

  it('aborts a running Job when a cancel was requested', async () => {
    const jobs = new MemoryJobDao()
    await jobs.enqueue([previewJob('a', 'doc-1')])
    let aborted = false
    const scheduler = build(jobs, {
      [JobKind.Preview]: {
        async run([item]) {
          if (item === undefined) return []
          await new Promise<void>((resolve) => {
            item.context.signal.addEventListener('abort', () => {
              aborted = true
              resolve()
            })
          })
          throw new StaleJobError()
        },
      },
    })
    await scheduler.start()
    await until(
      async () => (await jobs.findById('a'))?.state === JobState.Running,
    )
    await jobs.requestCancel('a', '2026-01-01T00:00:05.000Z')
    await until(
      async () => (await jobs.findById('a'))?.state === JobState.Cancelled,
    )
    expect(aborted).toBe(true)
  })

  it('saves the progress a handler reports', async () => {
    const jobs = new MemoryJobDao()
    await jobs.enqueue([previewJob('a', 'doc-1')])
    let release: () => void = () => {}
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const scheduler = build(jobs, {
      [JobKind.Preview]: finishing(async ({ context }) => {
        context.setProgress(0.4)
        await hold
      }),
    })
    await scheduler.start()
    await until(async () => (await jobs.findById('a'))?.progress === 0.4)
    release()
  })

  it('queues the Jobs that follow one in the same step that finishes it', async () => {
    const jobs = new MemoryJobDao()
    await jobs.enqueue([previewJob('a', 'doc-1')])
    const next = previewJob('b', 'doc-1')
    const scheduler = build(jobs, {
      [JobKind.Preview]: {
        async run(items) {
          return items.map((item) =>
            item.job.id === 'a'
              ? { outcome: DONE_PREVIEW, next: [next] }
              : { outcome: DONE_PREVIEW },
          )
        },
      },
    })
    await scheduler.start()
    await until(async () => (await jobs.findById('b'))?.state === JobState.Done)
  })

  it('fails Jobs left running by a process that is gone, but not by one still alive', async () => {
    const jobs = new MemoryJobDao()
    await jobs.enqueue([
      previewJob('dead', 'doc-1'),
      previewJob('alive', 'doc-2'),
    ])
    await jobs.claim('dead', '2000@x', '2026-01-01T00:00:00.000Z')
    await jobs.claim('alive', '3000@x', '2026-01-01T00:00:00.000Z')
    const scheduler = build(
      jobs,
      {},
      { isAlive: (claim) => claim.startsWith('3000') },
    )
    await scheduler.start()
    const dead = await jobs.findById('dead')
    expect(dead).toMatchObject({ state: JobState.Failed })
    expect(dead?.error).toMatch(/stopped before it finished/)
    expect((await jobs.findById('alive'))?.state).toBe(JobState.Running)
  })

  it('lets two schedulers share a queue without running a Job twice', async () => {
    const jobs = new MemoryJobDao()
    await jobs.enqueue(
      Array.from({ length: 12 }, (_, i) => previewJob(`j${i}`, `doc-${i}`)),
    )
    const seen: string[] = []
    const handlers = {
      [JobKind.Preview]: finishing(({ job: started }) => {
        seen.push(started.id)
      }),
    }
    const first = build(jobs, handlers)
    const second = build(jobs, handlers, {
      identity: { pid: 2000, startedAt: ME.startedAt },
    })
    await Promise.all([first.start(), second.start()])
    await until(() => seen.length >= 12)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(seen).toHaveLength(12)
    expect(new Set(seen).size).toBe(12)
  })
})
