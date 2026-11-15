import type { WorkerPool } from '@/features/ai/ai-tools'

import type { JobDao, JobFilter } from '../dao/job-dao.ts'
import type { Actor } from '../domain/actor.ts'
import { isoNow } from '../domain/clock.ts'
import type { Clock, IdGenerator } from '../domain/clock.ts'
import { requireOwned } from '../domain/ownership.ts'
import { JobFailedError, LimitError } from '../errors.ts'
import { JOB_PRIORITY, JobState, isTerminal } from '../jobs/job-types.ts'
import type { JobKind, JobPayload, JobRecord } from '../jobs/job-types.ts'

const MISSING = 'That job does not exist.'
const TOO_MANY =
  'You have too many jobs waiting. Wait for some to finish, or cancel some, and try again.'
const CANCELLED = 'The job was cancelled.'
const DEFAULT_FOLLOW_MS = 500
const MILLISECONDS_PER_DAY = 86_400_000

/** What a caller may see of a Job. */
export type JobView = Pick<
  JobRecord,
  | 'id'
  | 'kind'
  | 'state'
  | 'progress'
  | 'result'
  | 'error'
  | 'documentId'
  | 'workflowRunId'
  | 'createdAt'
  | 'startedAt'
  | 'finishedAt'
>

/** A Job to queue; the service fills in the rest. */
export type NewJob = {
  kind: JobKind
  payload: JobPayload
  pool: WorkerPool
  /** What fairness shares between: the Document id or the workflow run id. */
  groupKey: string
  documentId?: string
  workflowRunId?: string
}

export type JobServiceDependencies = {
  jobs: JobDao
  clock: Clock
  ids: IdGenerator
  maxWaitingPerUser: number
  /** Told after Jobs are queued, so a scheduler in this process can start on them at once. */
  onQueued(): void
  followIntervalMs?: number
}

export function toView(job: JobRecord): JobView {
  return {
    id: job.id,
    kind: job.kind,
    state: job.state,
    progress: job.progress,
    result: job.result,
    error: job.error,
    documentId: job.documentId,
    workflowRunId: job.workflowRunId,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  }
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

/** Queues Jobs and lets their owner look at them, cancel them and wait for them. */
export class JobService {
  readonly #deps: JobServiceDependencies

  constructor(deps: JobServiceDependencies) {
    this.#deps = deps
  }

  /** Queues Jobs for the User, refusing when that would leave too many waiting. */
  async enqueue(
    actor: Actor,
    specs: ReadonlyArray<NewJob>,
  ): Promise<JobRecord[]> {
    const { jobs, maxWaitingPerUser } = this.#deps
    if (specs.length === 0) return []
    const waiting = await jobs.countWaitingForOwner(actor.userId)
    if (waiting + specs.length > maxWaitingPerUser) {
      throw new LimitError(TOO_MANY)
    }
    const records = this.build(actor, specs)
    await jobs.enqueue(records)
    this.#deps.onQueued()
    return records
  }

  /**
   * Makes the records for Jobs without queueing them, for a Job that hands
   * the next step of a run to the Job that follows it. The limit on waiting
   * Jobs is not applied: that work was accepted when the run started.
   */
  build(actor: Actor, specs: ReadonlyArray<NewJob>): JobRecord[] {
    const { clock, ids } = this.#deps
    const createdAt = isoNow(clock)
    return specs.map(
      (spec): JobRecord => ({
        id: ids.next(),
        kind: spec.kind,
        ownerId: actor.userId,
        pool: spec.pool,
        priority: JOB_PRIORITY[spec.kind],
        groupKey: spec.groupKey,
        documentId: spec.documentId ?? null,
        workflowRunId: spec.workflowRunId ?? null,
        state: JobState.Waiting,
        progress: 0,
        payload: spec.payload,
        result: null,
        error: null,
        claimedBy: null,
        cancelRequested: false,
        createdAt,
        startedAt: null,
        finishedAt: null,
      }),
    )
  }

  async get(actor: Actor, id: string): Promise<JobView> {
    return toView(await this.#owned(actor, id))
  }

  async list(actor: Actor, filter: JobFilter = {}): Promise<JobView[]> {
    const found = await this.#deps.jobs.list(actor.userId, filter)
    return found.map(toView)
  }

  /** Drops a waiting Job or asks a running one to stop; a finished Job is left as it is. */
  async cancel(actor: Actor, id: string): Promise<JobView> {
    await this.#owned(actor, id)
    await this.#deps.jobs.requestCancel(id, isoNow(this.#deps.clock))
    return this.get(actor, id)
  }

  /**
   * Yields the Jobs' state each time any of them changes, until every one has
   * ended (or `signal` aborts). The first yield is the state right now.
   */
  async *follow(
    actor: Actor,
    ids: ReadonlyArray<string>,
    signal?: AbortSignal,
  ): AsyncGenerator<JobView[]> {
    const interval = this.#deps.followIntervalMs ?? DEFAULT_FOLLOW_MS
    let last = ''
    while (!signal?.aborted) {
      const views: JobView[] = []
      for (const id of ids) views.push(await this.get(actor, id))
      const snapshot = JSON.stringify(
        views.map(({ id, state, progress }) => [id, state, progress]),
      )
      if (snapshot !== last) {
        last = snapshot
        yield views
      }
      if (views.every(({ state }) => isTerminal(state))) return
      await sleep(interval, signal)
    }
  }

  /** Waits for one Job to end. Returns it when it finished; fails with `JobFailedError` when it failed or was cancelled. */
  async waitFor(actor: Actor, id: string): Promise<JobView> {
    let latest = await this.get(actor, id)
    for await (const views of this.follow(actor, [id])) {
      latest = views[0] ?? latest
    }
    if (latest.state === JobState.Done) return latest
    throw new JobFailedError(latest.error ?? CANCELLED)
  }

  /** Deletes finished Jobs older than the retention period. Their images are Renders or Results and are not touched. */
  async sweepFinished(retentionDays: number): Promise<number> {
    const { jobs, clock } = this.#deps
    const cutoff = new Date(
      clock.now().getTime() - retentionDays * MILLISECONDS_PER_DAY,
    ).toISOString()
    return jobs.deleteFinishedBefore(cutoff)
  }

  async #owned(actor: Actor, id: string): Promise<JobRecord> {
    return requireOwned(actor, await this.#deps.jobs.findById(id), MISSING)
  }
}
