import type { Logger } from '../http/logger.ts'
import { isStop, outcomeOfError } from './job-failure.ts'
import type { JobOutcome, JobRecord } from './job-types.ts'

/** What a handler can do while running one Job. */
export interface JobContext {
  /** Aborted when the Job is cancelled. */
  signal: AbortSignal
  /** Reports how much is done, from 0 to 1. Saved at a limited rate. */
  setProgress(fraction: number): void
}

export interface JobItem {
  job: JobRecord
  context: JobContext
}

/** How one Job ended, with the Jobs that follow it (queued in the same transaction). */
export interface JobReport {
  outcome: JobOutcome
  next?: ReadonlyArray<JobRecord>
}

/**
 * Does the work of one kind of Job. It gets one Job, or several when they
 * share a batch key, and answers for each in the same order. Throwing fails
 * every Job of the call; an answer fails only its own.
 */
export interface JobHandler {
  run(items: ReadonlyArray<JobItem>): Promise<ReadonlyArray<JobReport>>
}

/** The Job's Document changed after the Job was queued, so its work would be thrown away. */
export class StaleJobError extends Error {
  constructor() {
    super('The image changed before this job started.')
    this.name = 'StaleJobError'
  }
}

/** The Job was stopped on purpose. */
export class JobCancelledError extends Error {
  constructor() {
    super('The job was cancelled.')
    this.name = 'JobCancelledError'
  }
}

/** Runs `work` for each Job on its own, so one that fails or goes stale does not take the others with it. */
export async function runEach(
  items: ReadonlyArray<JobItem>,
  work: (item: JobItem) => Promise<JobReport>,
  logger: Logger,
): Promise<JobReport[]> {
  const reports: JobReport[] = []
  for (const item of items) {
    try {
      reports.push(await work(item))
    } catch (error) {
      if (!isStop(error)) {
        logger.error('A job failed', {
          jobId: item.job.id,
          detail: error instanceof Error ? error.message : String(error),
        })
      }
      reports.push({ outcome: outcomeOfError(error) })
    }
  }
  return reports
}

/** Raised when a handler is given a Job that is not its kind; handlers only receive their own, so it is a bug. */
export class WrongJobKindError extends Error {
  constructor(job: JobRecord) {
    super(`Job ${job.id} was given to the wrong handler.`)
    this.name = 'WrongJobKindError'
  }
}
