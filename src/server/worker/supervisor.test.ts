// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkerPool } from '@/features/ai/ai-tools'

import { MemoryJobDao } from '../dao/memory/job-dao'
import { job } from '../dao/contract/job-dao.contract'
import { MemoryLogger } from '../http/logger'
import { FakeWorkerProcess } from '../testing/fakes'
import { WorkerSupervisor } from './supervisor'
import type { SupervisorTiming } from './supervisor'

const TIMING: SupervisorTiming = {
  restartDelayMs: 100,
  maxRestartDelayMs: 400,
  stableAfterMs: 1000,
  gpuCheckMs: 50,
  gpuIdleMs: 500,
  stopTimeoutMs: 2000,
}

let started: FakeWorkerProcess[]
let queue: MemoryJobDao
let reaped: number
let logger: MemoryLogger
let supervisor: WorkerSupervisor

function build(
  counts: Record<WorkerPool, number> = {
    [WorkerPool.Cpu]: 2,
    [WorkerPool.Gpu]: 1,
  },
  reapOrphans: () => Promise<number> = async () => {
    reaped += 1
    return 0
  },
): WorkerSupervisor {
  supervisor = new WorkerSupervisor({
    counts,
    startWorker: (pool) => {
      const worker = new FakeWorkerProcess(pool)
      started.push(worker)
      return worker
    },
    queue,
    reapOrphans,
    logger,
    timing: TIMING,
  })
  return supervisor
}

function live(pool?: WorkerPool): FakeWorkerProcess[] {
  return started.filter(
    (worker) => !worker.exited && (pool === undefined || worker.pool === pool),
  )
}

async function queueGpuJob(id = 'ai-job'): Promise<void> {
  await queue.enqueue([
    job({ id, ownerId: 'ann', pool: WorkerPool.Gpu, groupKey: 'doc' }),
  ])
}

beforeEach(() => {
  vi.useFakeTimers()
  started = []
  queue = new MemoryJobDao()
  reaped = 0
  logger = new MemoryLogger()
})

afterEach(async () => {
  const stopping = supervisor.stop()
  for (const worker of live()) worker.exit({ code: 0, signal: null })
  await vi.advanceTimersByTimeAsync(TIMING.stopTimeoutMs)
  await stopping
  vi.useRealTimers()
})

describe('the worker supervisor', () => {
  it('starts one process per CPU worker, and no GPU worker while no AI job is queued', async () => {
    await build().start()

    expect(live(WorkerPool.Cpu)).toHaveLength(2)
    expect(live(WorkerPool.Gpu)).toHaveLength(0)
  })

  it('fails the jobs a stopped process left running before it starts any worker', async () => {
    const order: string[] = []
    supervisor = new WorkerSupervisor({
      counts: { [WorkerPool.Cpu]: 1, [WorkerPool.Gpu]: 1 },
      startWorker: (pool) => {
        order.push('start')
        const worker = new FakeWorkerProcess(pool)
        started.push(worker)
        return worker
      },
      queue,
      reapOrphans: async () => {
        order.push('reap')
        return 0
      },
      logger,
      timing: TIMING,
    })

    await supervisor.start()

    expect(order).toEqual(['reap', 'start'])
  })

  it('wakes the ready workers of a pool when a job is queued, and not the ones starting or stopping', async () => {
    await build().start()
    const [ready, stopping] = live(WorkerPool.Cpu)
    ready?.ready()
    stopping?.ready()
    stopping?.stopping()

    supervisor.wake([WorkerPool.Cpu])

    expect(ready?.sent).toEqual([{ type: 'wake' }])
    expect(stopping?.sent).toEqual([])
  })

  it('starts the GPU worker when an AI job is queued, once', async () => {
    await build().start()

    supervisor.wake([WorkerPool.Gpu])
    supervisor.wake([WorkerPool.Gpu])

    expect(live(WorkerPool.Gpu)).toHaveLength(1)
  })

  it('starts the GPU worker for an AI job another process queued', async () => {
    await build().start()

    await queueGpuJob()
    await vi.advanceTimersByTimeAsync(TIMING.gpuCheckMs * 2)

    expect(live(WorkerPool.Gpu)).toHaveLength(1)
  })

  it('stops the GPU worker after it has been idle a while, and starts it again for the next AI job', async () => {
    await build().start()
    supervisor.wake([WorkerPool.Gpu])
    const [gpu] = live(WorkerPool.Gpu)
    gpu?.ready()

    await vi.advanceTimersByTimeAsync(TIMING.gpuIdleMs + TIMING.gpuCheckMs * 2)
    expect(gpu?.stopRequested).toBe(true)
    gpu?.exit({ code: 0, signal: null })
    await vi.advanceTimersByTimeAsync(TIMING.maxRestartDelayMs * 2)
    expect(live(WorkerPool.Gpu)).toHaveLength(0)

    supervisor.wake([WorkerPool.Gpu])
    expect(live(WorkerPool.Gpu)).toHaveLength(1)
  })

  it('keeps the GPU worker while an AI job is waiting or running', async () => {
    await build().start()
    await queueGpuJob()
    await vi.advanceTimersByTimeAsync(TIMING.gpuCheckMs * 2)
    const [gpu] = live(WorkerPool.Gpu)
    gpu?.ready()

    await vi.advanceTimersByTimeAsync(TIMING.gpuIdleMs * 2)
    expect(gpu?.stopRequested).toBe(false)

    await queue.claim('ai-job', 'gpu-worker', new Date().toISOString())
    await vi.advanceTimersByTimeAsync(TIMING.gpuIdleMs * 2)
    expect(gpu?.stopRequested).toBe(false)
  })

  it('restarts a worker that stops, waiting longer each time it stops again', async () => {
    build({ [WorkerPool.Cpu]: 1, [WorkerPool.Gpu]: 1 })
    await supervisor.start()
    const delays: number[] = []

    for (let crash = 0; crash < 4; crash += 1) {
      const [worker] = live(WorkerPool.Cpu)
      worker?.exit()
      let waited = 0
      while (live(WorkerPool.Cpu).length === 0) {
        await vi.advanceTimersByTimeAsync(10)
        waited += 10
      }
      delays.push(waited)
    }

    expect(delays).toEqual([100, 200, 400, 400])
    expect(logger.lines.some((entry) => entry.level === 'warn')).toBe(true)
  })

  it('waits the shortest time again for a worker that stayed up a while', async () => {
    build({ [WorkerPool.Cpu]: 1, [WorkerPool.Gpu]: 1 })
    await supervisor.start()
    live(WorkerPool.Cpu)[0]?.exit()
    await vi.advanceTimersByTimeAsync(TIMING.restartDelayMs)
    live(WorkerPool.Cpu)[0]?.exit()
    await vi.advanceTimersByTimeAsync(TIMING.restartDelayMs * 2)
    const [steady] = live(WorkerPool.Cpu)
    steady?.ready()

    await vi.advanceTimersByTimeAsync(TIMING.stableAfterMs)
    steady?.exit()
    await vi.advanceTimersByTimeAsync(TIMING.restartDelayMs)

    expect(live(WorkerPool.Cpu)).toHaveLength(1)
  })

  it('fails the job of a worker that stopped as soon as it stops', async () => {
    await build().start()
    const before = reaped

    live(WorkerPool.Cpu)[0]?.exit({ code: null, signal: 'SIGKILL' })
    await vi.advanceTimersByTimeAsync(0)

    expect(reaped).toBe(before + 1)
  })

  it('restarts a worker that could not be started at all', async () => {
    build({ [WorkerPool.Cpu]: 1, [WorkerPool.Gpu]: 1 })
    await supervisor.start()

    live(WorkerPool.Cpu)[0]?.exit({ code: null, signal: null })
    await vi.advanceTimersByTimeAsync(TIMING.restartDelayMs)

    expect(live(WorkerPool.Cpu)).toHaveLength(1)
  })

  it('keeps going when looking at the queue fails, and says so', async () => {
    queue.listWaiting = async () => {
      throw new Error('connection lost')
    }
    await build().start()

    await vi.advanceTimersByTimeAsync(TIMING.gpuCheckMs * 2)

    expect(
      logger.lines.some(
        (entry) =>
          entry.level === 'error' &&
          /connection lost/.test(String(entry.fields.detail)),
      ),
    ).toBe(true)
    expect(live(WorkerPool.Cpu)).toHaveLength(2)
  })

  it('keeps going when failing a stopped worker’s jobs fails, and says so', async () => {
    let calls = 0
    build({ [WorkerPool.Cpu]: 1, [WorkerPool.Gpu]: 1 }, async () => {
      calls += 1
      if (calls > 1) throw new Error('database gone')
      return 0
    })
    await supervisor.start()

    live(WorkerPool.Cpu)[0]?.exit()
    await vi.advanceTimersByTimeAsync(TIMING.restartDelayMs)

    expect(logger.lines.some((entry) => entry.level === 'error')).toBe(true)
    expect(live(WorkerPool.Cpu)).toHaveLength(1)
  })

  describe('when it stops', () => {
    it('asks every worker to stop, waits for them to finish their jobs, and starts no other', async () => {
      await build().start()
      supervisor.wake([WorkerPool.Gpu])
      const workers = live()

      let done = false
      const stopping = supervisor.stop().then(() => {
        done = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(workers.every((worker) => worker.stopRequested)).toBe(true)
      expect(done).toBe(false)

      for (const worker of workers) worker.exit({ code: 0, signal: null })
      await stopping
      await vi.advanceTimersByTimeAsync(TIMING.maxRestartDelayMs * 2)

      expect(started).toHaveLength(workers.length)
      expect(workers.some((worker) => worker.killed)).toBe(false)
    })

    it('does not start a worker whose restart was waiting', async () => {
      build({ [WorkerPool.Cpu]: 1, [WorkerPool.Gpu]: 1 })
      await supervisor.start()
      live(WorkerPool.Cpu)[0]?.exit()

      await supervisor.stop()
      await vi.advanceTimersByTimeAsync(TIMING.maxRestartDelayMs * 2)

      expect(started).toHaveLength(1)
    })

    it('ends a worker that has not stopped in time, and fails the job it left', async () => {
      build({ [WorkerPool.Cpu]: 1, [WorkerPool.Gpu]: 1 })
      await supervisor.start()
      const [stuck] = live(WorkerPool.Cpu)
      const before = reaped

      const stopping = supervisor.stop()
      await vi.advanceTimersByTimeAsync(TIMING.stopTimeoutMs)
      await stopping

      expect(stuck?.killed).toBe(true)
      expect(reaped).toBeGreaterThan(before)
      expect(
        logger.lines.some(
          (entry) => entry.level === 'warn' && entry.fields.pid === stuck?.pid,
        ),
      ).toBe(true)
    })

    it('can be asked to stop more than once', async () => {
      await build().start()
      const first = supervisor.stop()
      const second = supervisor.stop()
      for (const worker of live()) worker.exit({ code: 0, signal: null })

      await Promise.all([first, second])
      expect(first).toBe(second)
    })
  })
})
