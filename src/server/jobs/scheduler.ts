import { WorkerPool } from '@/features/ai/ai-tools'

import type { JobDao } from '../dao/job-dao.ts'
import type { Clock } from '../domain/clock.ts'
import { isoNow } from '../domain/clock.ts'
import type { Logger } from '../http/logger.ts'
import type {
  JobContext,
  JobHandler,
  JobItem,
  JobReport,
} from './job-handler.ts'
import { isStop, outcomeOfError } from './job-failure.ts'
import { JobState, batchKeyOf } from './job-types.ts'
import type { JobKind, JobRecord } from './job-types.ts'
import { pickBatchCompanions, pickNextJob } from './pick-next-job.ts'
import {
  currentIdentity,
  formatClaim,
  isClaimAlive,
} from './process-identity.ts'
import type { ProcessIdentity } from './process-identity.ts'

const DEFAULT_POLL_MS = 1000
const DEFAULT_CANCEL_POLL_MS = 500
const DEFAULT_REAP_MS = 60_000
const DEFAULT_PROGRESS_SAVE_MS = 250
const DEFAULT_BATCH_WINDOW_MS = 300
const MAX_CLAIM_ATTEMPTS = 20
const MAX_REMEMBERED_GROUPS = 5000
const ORPHANED = 'The program running this job stopped before it finished.'

export type SchedulerOptions = {
  jobs: JobDao
  handlers: Readonly<Partial<Record<JobKind, JobHandler>>>
  clock: Clock
  logger: Logger
  /** Slots per pool; a pool with none is never run by this process. */
  slots: Readonly<Record<WorkerPool, number>>
  groupSharePercent: number
  /** The most Jobs that may run as one batch, for a Job that can batch. */
  batchLimit(job: JobRecord): number
  identity?: ProcessIdentity
  isAlive?: (claim: string) => boolean
  /** Told after a Job has ended, whoever ended it, for work that depends on it (closing a workflow run). */
  onFinished?: (job: JobRecord) => Promise<void>
  pollMs?: number
  cancelPollMs?: number
  reapMs?: number
  progressSaveMs?: number
  /** How long a Job that can batch waits for companions to be queued before it is started alone. */
  batchWindowMs?: number
}

type Running = {
  job: JobRecord
  controller: AbortController
}

/**
 * Takes Jobs from the shared queue and runs them in two pools (CPU and GPU).
 * Every process that wants Jobs run builds one: the server and the CLI both do,
 * and the atomic claim in the DAO keeps two of them from taking the same Job.
 * Fairness and batching are decided by pure functions; this class is the loop,
 * the timers, cancellation and the bookkeeping around them.
 */
export class Scheduler {
  readonly #options: SchedulerOptions
  readonly #identity: ProcessIdentity
  readonly #active = new Map<WorkerPool, number>()
  readonly #executions = new Set<Promise<void>>()
  readonly #running = new Map<string, Running>()
  readonly #lastServed = new Map<string, number>()
  #servedCount = 0
  #timers: ReturnType<typeof setInterval>[] = []
  #started = false
  #filling = false
  #refill = false

  constructor(options: SchedulerOptions) {
    this.#options = options
    this.#identity = options.identity ?? currentIdentity()
  }

  /** Starts taking Jobs. First fails the Jobs that were running in a process that no longer exists. */
  async start(): Promise<void> {
    if (this.#started) return
    this.#started = true
    await this.reapOrphans()
    // Stopped while the orphans were failed: start no timers.
    if (!this.#started) return
    const { pollMs = DEFAULT_POLL_MS, reapMs = DEFAULT_REAP_MS } = this.#options
    this.#timers = [
      setInterval(() => this.wake(), pollMs),
      setInterval(() => void this.#reapSafely(), reapMs),
    ]
    for (const timer of this.#timers) timer.unref()
    this.wake()
  }

  /** Stops taking Jobs and waits for the ones running; `abort` asks them to stop first. */
  async stop(options: { abort?: boolean } = {}): Promise<void> {
    this.#started = false
    for (const timer of this.#timers) clearInterval(timer)
    this.#timers = []
    if (options.abort) {
      for (const { controller } of this.#running.values()) controller.abort()
    }
    await Promise.allSettled([...this.#executions])
  }

  /** Says there may be new work; fills any free slot soon. */
  wake(): void {
    if (!this.#started) return
    if (this.#filling) {
      this.#refill = true
      return
    }
    void this.#fill()
  }

  /** Fails Jobs whose process is gone. Returns how many. */
  async reapOrphans(): Promise<number> {
    const { jobs, clock, logger } = this.#options
    const alive =
      this.#options.isAlive ??
      ((claim: string) => isClaimAlive(claim, this.#identity))
    let failed = 0
    for (const job of await jobs.listRunning()) {
      if (job.claimedBy !== null && alive(job.claimedBy)) continue
      const done = await jobs.finish(
        job.id,
        { state: JobState.Failed, error: ORPHANED },
        [],
        isoNow(clock),
      )
      if (!done) continue
      await this.#notifyFinished(job)
      failed += 1
      logger.warn('Failed a job whose process is gone', { jobId: job.id })
    }
    return failed
  }

  async #reapSafely(): Promise<void> {
    try {
      await this.reapOrphans()
    } catch (error) {
      this.#logError('Checking for stopped jobs failed', error)
    }
  }

  async #fill(): Promise<void> {
    this.#filling = true
    try {
      do {
        this.#refill = false
        for (const pool of [WorkerPool.Gpu, WorkerPool.Cpu]) {
          await this.#fillPool(pool)
        }
      } while (this.#refill && this.#started)
    } catch (error) {
      this.#logError('Looking for jobs to run failed', error)
    } finally {
      this.#filling = false
    }
  }

  async #fillPool(pool: WorkerPool): Promise<void> {
    const slots = this.#options.slots[pool]
    while (this.#started && (this.#active.get(pool) ?? 0) < slots) {
      const claimed = await this.#claimNext(pool)
      if (claimed === undefined) return
      this.#active.set(pool, (this.#active.get(pool) ?? 0) + 1)
      const execution = this.#execute(pool, claimed).finally(() => {
        this.#executions.delete(execution)
      })
      this.#executions.add(execution)
    }
  }

  async #claimNext(pool: WorkerPool): Promise<JobRecord[] | undefined> {
    const { jobs, handlers, clock, groupSharePercent } = this.#options
    const slots = this.#options.slots[pool]
    let waiting = (await jobs.listWaiting(pool)).filter(
      (job) => handlers[job.kind] !== undefined,
    )
    const running = await jobs.countRunningByGroup(pool)
    for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
      const primary = pickNextJob(waiting, running, this.#lastServed, {
        slots,
        groupSharePercent,
      })
      if (primary === undefined) return undefined
      const limit = this.#options.batchLimit(primary)
      const companions = pickBatchCompanions(primary, waiting, limit)
      const hold = this.#holdForCompanions(primary, companions.length, limit)
      if (hold > 0) {
        this.#wakeIn(hold)
        return undefined
      }
      const claim = formatClaim(this.#identity)
      if (!(await jobs.claim(primary.id, claim, isoNow(clock)))) {
        waiting = waiting.filter((job) => job.id !== primary.id)
        continue
      }
      this.#markServed(primary.groupKey)
      const claimed = [this.#asRunning(primary, claim)]
      for (const companion of companions) {
        if (await jobs.claim(companion.id, claim, isoNow(clock))) {
          claimed.push(this.#asRunning(companion, claim))
        }
      }
      return claimed
    }
    return undefined
  }

  /** How much longer a Job that can batch should wait for companions; 0 when it should go now. */
  #holdForCompanions(
    job: JobRecord,
    companions: number,
    limit: number,
  ): number {
    if (batchKeyOf(job) === undefined || companions + 1 >= limit) return 0
    const window = this.#options.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS
    if (window <= 0) return 0
    const queued =
      this.#options.clock.now().getTime() - Date.parse(job.createdAt)
    return Math.max(window - Math.max(queued, 0), 0)
  }

  #wakeIn(milliseconds: number): void {
    const timer = setTimeout(() => this.wake(), milliseconds)
    timer.unref()
  }

  #markServed(groupKey: string): void {
    this.#servedCount += 1
    this.#lastServed.delete(groupKey)
    this.#lastServed.set(groupKey, this.#servedCount)
    if (this.#lastServed.size <= MAX_REMEMBERED_GROUPS) return
    const oldest = this.#lastServed.keys().next()
    if (!oldest.done) this.#lastServed.delete(oldest.value)
  }

  #asRunning(job: JobRecord, claim: string): JobRecord {
    return {
      ...job,
      state: JobState.Running,
      claimedBy: claim,
      startedAt: isoNow(this.#options.clock),
    }
  }

  async #execute(pool: WorkerPool, jobs: JobRecord[]): Promise<void> {
    const [first] = jobs
    const handler = first ? this.#options.handlers[first.kind] : undefined
    const running: Running[] = jobs.map((job) => ({
      job,
      controller: new AbortController(),
    }))
    for (const entry of running) this.#running.set(entry.job.id, entry)
    const watcher = setInterval(
      () => void this.#watchCancellation(running),
      this.#options.cancelPollMs ?? DEFAULT_CANCEL_POLL_MS,
    )
    try {
      const reports = await this.#run(handler, running)
      await this.#finishAll(running, reports)
    } finally {
      clearInterval(watcher)
      for (const entry of running) this.#running.delete(entry.job.id)
      this.#active.set(pool, (this.#active.get(pool) ?? 1) - 1)
      this.wake()
    }
  }

  async #run(
    handler: JobHandler | undefined,
    running: ReadonlyArray<Running>,
  ): Promise<ReadonlyArray<JobReport>> {
    const failure = (error: unknown): JobReport[] =>
      running.map(() => ({ outcome: outcomeOfError(error) }))
    if (handler === undefined) {
      return failure(new Error('No handler for this kind of job.'))
    }
    try {
      const items: JobItem[] = running.map((entry) => ({
        job: entry.job,
        context: this.#contextFor(entry),
      }))
      const reports = await handler.run(items)
      if (reports.length !== items.length) {
        throw new Error('A handler must answer for every job it is given.')
      }
      return reports
    } catch (error) {
      if (!isStop(error)) this.#logError('A job failed', error, running)
      return failure(error)
    }
  }

  #contextFor(entry: Running): JobContext {
    const { jobs, progressSaveMs = DEFAULT_PROGRESS_SAVE_MS } = this.#options
    let lastSaved = 0
    return {
      signal: entry.controller.signal,
      setProgress: (fraction) => {
        const now = Date.now()
        if (now - lastSaved < progressSaveMs) return
        lastSaved = now
        jobs
          .setProgress(entry.job.id, Math.min(Math.max(fraction, 0), 1))
          .catch((error: unknown) =>
            this.#logError('Saving progress failed', error, [entry]),
          )
      },
    }
  }

  async #finishAll(
    running: ReadonlyArray<Running>,
    reports: ReadonlyArray<JobReport>,
  ): Promise<void> {
    const { jobs, clock } = this.#options
    for (const [index, entry] of running.entries()) {
      const report = reports[index]
      if (report === undefined) continue
      try {
        const finished = await jobs.finish(
          entry.job.id,
          report.outcome,
          report.next ?? [],
          isoNow(clock),
        )
        if (finished) await this.#notifyFinished(entry.job)
      } catch (error) {
        this.#logError('Saving the end of a job failed', error, [entry])
      }
    }
  }

  async #notifyFinished(job: JobRecord): Promise<void> {
    try {
      await this.#options.onFinished?.(job)
    } catch (error) {
      this.#logError('Closing the work of a job failed', error)
    }
  }

  async #watchCancellation(running: ReadonlyArray<Running>): Promise<void> {
    for (const entry of running) {
      if (entry.controller.signal.aborted) continue
      try {
        const current = await this.#options.jobs.findById(entry.job.id)
        if (current?.cancelRequested) entry.controller.abort()
      } catch (error) {
        this.#logError('Checking for a cancel failed', error, [entry])
      }
    }
  }

  #logError(
    message: string,
    error: unknown,
    running: ReadonlyArray<Running> = [],
  ): void {
    this.#options.logger.error(message, {
      jobIds: running.map(({ job }) => job.id).join(','),
      detail:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    })
  }
}
