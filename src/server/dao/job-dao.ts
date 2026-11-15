import type { WorkerPool } from '@/features/ai/ai-tools'

import type {
  JobKind,
  JobOutcome,
  JobRecord,
  JobState,
} from '../jobs/job-types.ts'

export type JobFilter = {
  state?: ReadonlyArray<JobState>
  kind?: JobKind
  documentId?: string
  workflowRunId?: string
  /** At most this many, newest first. */
  limit?: number
}

export type ActiveJobFilter = {
  documentId?: string
  workflowRunId?: string
  kinds?: ReadonlyArray<JobKind>
}

/** What `requestCancel` did: dropped a waiting Job, asked a running one to stop, or found it already over. */
export type CancelResult = 'cancelled' | 'requested' | 'finished'

/**
 * Storage for Jobs. Every method is one whole operation; the rules for who
 * runs next and what is fair live in `pickNextJob`, built from these primitives.
 */
export interface JobDao {
  /** Adds Jobs in the `waiting` state, all or none. */
  enqueue(jobs: ReadonlyArray<JobRecord>): Promise<void>
  findById(id: string): Promise<JobRecord | null>
  /** The User's Jobs, newest first. */
  list(ownerId: string, filter: JobFilter): Promise<JobRecord[]>
  /** Waiting and running Jobs of any User. */
  listActive(filter: ActiveJobFilter): Promise<JobRecord[]>
  /** Waiting Jobs of a pool by priority, then age. */
  listWaiting(pool: WorkerPool): Promise<JobRecord[]>
  listRunning(): Promise<JobRecord[]>
  /** How many Jobs of each group a pool is running now. */
  countRunningByGroup(pool: WorkerPool): Promise<Map<string, number>>
  countWaitingForOwner(ownerId: string): Promise<number>
  /** Takes a waiting Job in one atomic step; false when another process got there first or it was cancelled. */
  claim(id: string, claimedBy: string, now: string): Promise<boolean>
  setProgress(id: string, progress: number): Promise<void>
  requestCancel(id: string, now: string): Promise<CancelResult>
  /**
   * Ends a running Job and queues the Jobs that follow it in one transaction,
   * so a crash cannot lose the next step of a workflow run. A Job that was
   * asked to cancel ends as cancelled even if it finished its work (the
   * result, if any, is kept) and queues no followers. False when the Job was no longer
   * running.
   */
  finish(
    id: string,
    outcome: JobOutcome,
    next: ReadonlyArray<JobRecord>,
    now: string,
  ): Promise<boolean>
  /** Deletes Jobs that ended before `cutoff`; returns how many. */
  deleteFinishedBefore(cutoff: string): Promise<number>
}
