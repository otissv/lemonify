import type { WorkerPool } from '@/features/ai/ai-tools'

import { JobState } from '../../jobs/job-types.ts'
import type { JobOutcome, JobRecord } from '../../jobs/job-types.ts'
import type {
  ActiveJobFilter,
  CancelResult,
  JobDao,
  JobFilter,
} from '../job-dao.ts'

function waitingOrder(a: JobRecord, b: JobRecord): number {
  return (
    a.priority - b.priority ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  )
}

function newestFirst(a: JobRecord, b: JobRecord): number {
  return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)
}

export class MemoryJobDao implements JobDao {
  readonly #jobs = new Map<string, JobRecord>()

  async enqueue(jobs: ReadonlyArray<JobRecord>): Promise<void> {
    const seen = new Set<string>()
    for (const job of jobs) {
      if (this.#jobs.has(job.id) || seen.has(job.id)) {
        throw new Error(`Job ${job.id} exists`)
      }
      seen.add(job.id)
    }
    for (const job of jobs) this.#jobs.set(job.id, { ...job })
  }

  async findById(id: string): Promise<JobRecord | null> {
    const job = this.#jobs.get(id)
    return job === undefined ? null : { ...job }
  }

  async list(ownerId: string, filter: JobFilter): Promise<JobRecord[]> {
    const jobs = [...this.#jobs.values()].filter(
      (job) =>
        job.ownerId === ownerId &&
        (filter.state === undefined || filter.state.includes(job.state)) &&
        (filter.kind === undefined || job.kind === filter.kind) &&
        (filter.documentId === undefined ||
          job.documentId === filter.documentId) &&
        (filter.workflowRunId === undefined ||
          job.workflowRunId === filter.workflowRunId),
    )
    jobs.sort(newestFirst)
    return jobs.slice(0, filter.limit ?? jobs.length).map((job) => ({ ...job }))
  }

  async listActive(filter: ActiveJobFilter): Promise<JobRecord[]> {
    return [...this.#jobs.values()]
      .filter(
        (job) =>
          (job.state === JobState.Waiting || job.state === JobState.Running) &&
          (filter.documentId === undefined ||
            job.documentId === filter.documentId) &&
          (filter.workflowRunId === undefined ||
            job.workflowRunId === filter.workflowRunId) &&
          (filter.kinds === undefined || filter.kinds.includes(job.kind)),
      )
      .sort(waitingOrder)
      .map((job) => ({ ...job }))
  }

  async listWaiting(pool: WorkerPool): Promise<JobRecord[]> {
    return [...this.#jobs.values()]
      .filter((job) => job.state === JobState.Waiting && job.pool === pool)
      .sort(waitingOrder)
      .map((job) => ({ ...job }))
  }

  async listRunning(): Promise<JobRecord[]> {
    return [...this.#jobs.values()]
      .filter((job) => job.state === JobState.Running)
      .map((job) => ({ ...job }))
  }

  async countRunningByGroup(pool: WorkerPool): Promise<Map<string, number>> {
    const counts = new Map<string, number>()
    for (const job of this.#jobs.values()) {
      if (job.state !== JobState.Running || job.pool !== pool) continue
      counts.set(job.groupKey, (counts.get(job.groupKey) ?? 0) + 1)
    }
    return counts
  }

  async countWaitingForOwner(ownerId: string): Promise<number> {
    let count = 0
    for (const job of this.#jobs.values()) {
      if (job.ownerId === ownerId && job.state === JobState.Waiting) count += 1
    }
    return count
  }

  async claim(id: string, claimedBy: string, now: string): Promise<boolean> {
    const job = this.#jobs.get(id)
    if (job?.state !== JobState.Waiting || job.cancelRequested) return false
    job.state = JobState.Running
    job.claimedBy = claimedBy
    job.startedAt = now
    return true
  }

  async setProgress(id: string, progress: number): Promise<void> {
    const job = this.#jobs.get(id)
    if (job?.state === JobState.Running) job.progress = progress
  }

  async requestCancel(id: string, now: string): Promise<CancelResult> {
    const job = this.#jobs.get(id)
    if (job === undefined) return 'finished'
    if (job.state === JobState.Waiting) {
      job.state = JobState.Cancelled
      job.finishedAt = now
      return 'cancelled'
    }
    if (job.state === JobState.Running) {
      job.cancelRequested = true
      return 'requested'
    }
    return 'finished'
  }

  async finish(
    id: string,
    outcome: JobOutcome,
    next: ReadonlyArray<JobRecord>,
    now: string,
  ): Promise<boolean> {
    const job = this.#jobs.get(id)
    if (job?.state !== JobState.Running) return false
    const stopped = job.cancelRequested
    job.state =
      stopped && outcome.state === JobState.Done
        ? JobState.Cancelled
        : outcome.state
    job.finishedAt = now
    if (outcome.state === JobState.Done) {
      job.result = outcome.result
      job.progress = 1
    }
    if (outcome.state === JobState.Failed) job.error = outcome.error
    if (!stopped) {
      for (const follower of next) this.#jobs.set(follower.id, { ...follower })
    }
    return true
  }

  async deleteFinishedBefore(cutoff: string): Promise<number> {
    let removed = 0
    for (const [id, job] of this.#jobs) {
      const finished = job.finishedAt
      if (finished !== null && finished < cutoff) {
        this.#jobs.delete(id)
        removed += 1
      }
    }
    return removed
  }
}
