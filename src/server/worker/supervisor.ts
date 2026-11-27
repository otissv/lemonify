import { WorkerPool } from '@/features/ai/ai-tools'

import type { JobDao } from '../dao/job-dao.ts'
import type { Logger } from '../http/logger.ts'
import type { StartWorker, WorkerExit, WorkerProcess } from './fork-worker.ts'
import type { WorkerMessage } from './worker-messages.ts'

/** How long the supervisor waits for things, in milliseconds. */
export type SupervisorTiming = {
  /** Before starting a worker that stopped the first time; doubled each time it stops again. */
  restartDelayMs: number
  /** The longest wait before a restart, however often a worker stops. */
  maxRestartDelayMs: number
  /** A worker up this long is working again, and its next stop is waited for the shortest time. */
  stableAfterMs: number
  /** How often the queue is checked for AI jobs, which other processes may have queued. */
  gpuCheckMs: number
  /** How long the GPU worker may have no AI job before it is stopped (decision 8, GPU worker start). */
  gpuIdleMs: number
  /** How long a worker may take to finish its job when the server stops, before it is ended. */
  stopTimeoutMs: number
}

export const DEFAULT_SUPERVISOR_TIMING: SupervisorTiming = {
  restartDelayMs: 1000,
  maxRestartDelayMs: 30_000,
  stableAfterMs: 60_000,
  gpuCheckMs: 2000,
  gpuIdleMs: 5 * 60_000,
  stopTimeoutMs: 120_000,
}

export type WorkerSupervisorOptions = {
  /** How many worker processes each pool has; the GPU ones run only while there is AI work. */
  counts: Readonly<Record<WorkerPool, number>>
  startWorker: StartWorker
  queue: Pick<JobDao, 'listWaiting' | 'countRunningByGroup'>
  /** Fails the jobs of processes that are gone, and tells their owners (`Scheduler.reapOrphans`). */
  reapOrphans(): Promise<number>
  logger: Logger
  timing?: SupervisorTiming
}

/** A worker process the supervisor runs now. */
export type WorkerStatus = {
  pool: WorkerPool
  pid: number | undefined
  /** It is taking jobs. */
  ready: boolean
}

enum WorkerState {
  Starting = 'starting',
  Ready = 'ready',
  Stopping = 'stopping',
}

type Running = {
  process: WorkerProcess
  state: WorkerState
  /** Asked to stop by the supervisor, so it is not restarted. */
  retiring: boolean
  exited: Promise<void>
  markExited(): void
}

/** One place in a pool, which holds a worker process or is waiting to start one. */
type Slot = {
  pool: WorkerPool
  running?: Running
  /** Stops in a row without staying up `stableAfterMs`, which sets the next restart's wait. */
  failures: number
  restartTimer?: ReturnType<typeof setTimeout>
  stableTimer?: ReturnType<typeof setTimeout>
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The web server's pool of worker processes (decision 1, worker processes;
 * decision 2, pool shape). It starts the CPU workers, starts the GPU workers
 * when an AI job is queued and stops them when they have been idle a while
 * (decision 8, GPU worker start), restarts a worker that stops with a wait
 * that grows each time, fails the jobs a stopped worker left, and stops them
 * all, letting their jobs finish, when the server stops.
 */
export class WorkerSupervisor {
  readonly #options: WorkerSupervisorOptions
  readonly #timing: SupervisorTiming
  readonly #slots: Slot[] = []
  readonly #reaps = new Set<Promise<void>>()
  #started = false
  #stopping: Promise<void> | undefined
  #gpuTimer: ReturnType<typeof setInterval> | undefined
  #checkingGpu = false
  #gpuIdleSince: number | undefined

  constructor(options: WorkerSupervisorOptions) {
    this.#options = options
    this.#timing = options.timing ?? DEFAULT_SUPERVISOR_TIMING
    for (const pool of [WorkerPool.Cpu, WorkerPool.Gpu]) {
      for (let index = 0; index < options.counts[pool]; index += 1) {
        this.#slots.push({ pool, failures: 0 })
      }
    }
  }

  /** Fails the jobs a stopped server's workers left, then starts the CPU workers and watches for AI jobs. */
  async start(): Promise<void> {
    if (this.#started || this.#stopping !== undefined) return
    this.#started = true
    await this.#reap()
    for (const slot of this.#slotsOf(WorkerPool.Cpu)) this.#launch(slot)
    this.#gpuTimer = setInterval(
      () => void this.#checkGpu(),
      this.#timing.gpuCheckMs,
    )
    this.#gpuTimer.unref()
    void this.#checkGpu()
  }

  /** Says jobs of these pools were queued: wakes their ready workers, and starts the GPU workers if they are not running. */
  wake(pools: Iterable<WorkerPool>): void {
    if (!this.#started) return
    for (const pool of new Set(pools)) {
      if (pool === WorkerPool.Gpu) this.#startGpu()
      for (const slot of this.#slotsOf(pool)) {
        if (slot.running?.state === WorkerState.Ready) {
          slot.running.process.send({ type: 'wake' })
        }
      }
    }
  }

  /** The worker processes running now. */
  workers(): WorkerStatus[] {
    const statuses: WorkerStatus[] = []
    for (const { pool, running } of this.#slots) {
      if (running === undefined) continue
      statuses.push({
        pool,
        pid: running.process.pid,
        ready: running.state === WorkerState.Ready,
      })
    }
    return statuses
  }

  /** Asks every worker to stop and waits for their jobs to finish; one that takes too long is ended and its job failed. */
  stop(): Promise<void> {
    this.#stopping ??= this.#stopAll()
    return this.#stopping
  }

  async #stopAll(): Promise<void> {
    this.#started = false
    if (this.#gpuTimer !== undefined) clearInterval(this.#gpuTimer)
    const exits: Promise<void>[] = []
    for (const slot of this.#slots) {
      clearTimeout(slot.restartTimer)
      clearTimeout(slot.stableTimer)
      const { running } = slot
      if (running === undefined) continue
      running.retiring = true
      running.process.stop()
      exits.push(this.#endInTime(slot.pool, running))
    }
    await Promise.all(exits)
    await Promise.all([...this.#reaps])
  }

  async #endInTime(pool: WorkerPool, running: Running): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        this.#options.logger.warn(
          'A worker did not finish its job in time; ending it',
          { pool, pid: running.process.pid ?? null },
        )
        running.process.kill()
        resolve()
      }, this.#timing.stopTimeoutMs)
    })
    await Promise.race([running.exited, late])
    clearTimeout(timer)
    await running.exited
  }

  #slotsOf(pool: WorkerPool): Slot[] {
    return this.#slots.filter((slot) => slot.pool === pool)
  }

  #launch(slot: Slot): void {
    const worker = this.#options.startWorker(slot.pool)
    let markExited = () => {}
    const exited = new Promise<void>((resolve) => {
      markExited = resolve
    })
    const running: Running = {
      process: worker,
      state: WorkerState.Starting,
      retiring: false,
      exited,
      markExited,
    }
    slot.running = running
    worker.onMessage((message) => this.#heard(slot, running, message))
    worker.onExit((exit) => this.#exited(slot, running, exit))
    this.#options.logger.info('Started a worker', {
      pool: slot.pool,
      pid: worker.pid ?? null,
    })
  }

  #heard(slot: Slot, running: Running, message: WorkerMessage): void {
    if (message.type === 'stopping') {
      running.state = WorkerState.Stopping
      return
    }
    running.state = WorkerState.Ready
    clearTimeout(slot.stableTimer)
    slot.stableTimer = setTimeout(() => {
      slot.failures = 0
    }, this.#timing.stableAfterMs)
    slot.stableTimer.unref()
  }

  #exited(slot: Slot, running: Running, exit: WorkerExit): void {
    if (slot.running !== running) return
    slot.running = undefined
    clearTimeout(slot.stableTimer)
    const reaping = this.#reap().finally(() => this.#reaps.delete(reaping))
    this.#reaps.add(reaping)
    running.markExited()
    if (!this.#started || running.retiring) return
    slot.failures += 1
    const delay = Math.min(
      this.#timing.restartDelayMs * 2 ** (slot.failures - 1),
      this.#timing.maxRestartDelayMs,
    )
    this.#options.logger.warn('A worker stopped; starting another', {
      pool: slot.pool,
      pid: running.process.pid ?? null,
      code: exit.code,
      signal: exit.signal,
      restartInMs: delay,
    })
    slot.restartTimer = setTimeout(() => {
      slot.restartTimer = undefined
      if (this.#started) this.#launch(slot)
    }, delay)
    slot.restartTimer.unref()
  }

  async #reap(): Promise<void> {
    try {
      await this.#options.reapOrphans()
    } catch (error) {
      this.#options.logger.error(
        'Failing the jobs of a stopped worker failed',
        {
          detail: detailOf(error),
        },
      )
    }
  }

  /** Starts the GPU workers that are neither running nor waiting to restart. */
  #startGpu(): void {
    this.#gpuIdleSince = undefined
    for (const slot of this.#slotsOf(WorkerPool.Gpu)) {
      if (slot.running === undefined && slot.restartTimer === undefined) {
        this.#launch(slot)
      }
    }
  }

  async #checkGpu(): Promise<void> {
    if (!this.#started || this.#checkingGpu) return
    this.#checkingGpu = true
    try {
      const { queue } = this.#options
      const waiting = (await queue.listWaiting(WorkerPool.Gpu)).length
      let running = 0
      for (const count of (
        await queue.countRunningByGroup(WorkerPool.Gpu)
      ).values()) {
        running += count
      }
      if (this.#started) this.#followGpuWork(waiting, running)
    } catch (error) {
      this.#options.logger.error('Checking the queue for AI jobs failed', {
        detail: detailOf(error),
      })
    } finally {
      this.#checkingGpu = false
    }
  }

  #followGpuWork(waiting: number, running: number): void {
    if (waiting > 0) this.#startGpu()
    const live = this.#slotsOf(WorkerPool.Gpu).filter(
      (slot) => slot.running !== undefined && !slot.running.retiring,
    )
    if (waiting + running > 0 || live.length === 0) {
      this.#gpuIdleSince = undefined
      return
    }
    const now = Date.now()
    this.#gpuIdleSince ??= now
    if (now - this.#gpuIdleSince < this.#timing.gpuIdleMs) return
    this.#gpuIdleSince = undefined
    for (const slot of live) {
      if (slot.running === undefined) continue
      slot.running.retiring = true
      slot.running.process.stop()
    }
    this.#options.logger.info('Stopped the GPU worker: no AI job for a while', {
      idleMs: this.#timing.gpuIdleMs,
    })
  }
}
