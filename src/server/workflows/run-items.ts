import { JobKind, JobState } from '../jobs/job-types.ts'
import type { JobRecord } from '../jobs/job-types.ts'

/** Where one image of a run has got to. */
export enum RunItemState {
  Waiting = 'waiting',
  Running = 'running',
  Done = 'done',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

/** One image of a run: where it has got to, and the Results it made once done. */
export type RunItem = {
  sourceId: string
  state: RunItemState
  resultIds: string[]
}

function itemOf(sourceId: string, jobs: ReadonlyArray<JobRecord>): RunItem {
  const made = jobs.find(
    (job) =>
      job.state === JobState.Done &&
      job.result?.kind === JobKind.RunItem &&
      job.result.resultIds.length > 0,
  )
  if (made?.result?.kind === JobKind.RunItem) {
    return {
      sourceId,
      state: RunItemState.Done,
      resultIds: [...made.result.resultIds],
    }
  }
  const has = (state: JobState): boolean =>
    jobs.some((job) => job.state === state)
  const state = has(JobState.Failed)
    ? RunItemState.Failed
    : has(JobState.Cancelled)
      ? RunItemState.Cancelled
      : has(JobState.Running)
        ? RunItemState.Running
        : RunItemState.Waiting
  return { sourceId, state, resultIds: [] }
}

/**
 * Each image of a run, in the order it was chosen, from the Jobs of the run:
 * done once a Job has made its files (only the last step of an image does),
 * failed or cancelled when one of its Jobs was, running while one runs, and
 * waiting otherwise, which includes between two steps.
 */
export function runItems(
  sourceIds: ReadonlyArray<string>,
  jobs: ReadonlyArray<JobRecord>,
): RunItem[] {
  const bySource = new Map<string, JobRecord[]>()
  for (const job of jobs) {
    if (job.payload.kind !== JobKind.RunItem) continue
    const list = bySource.get(job.payload.sourceId) ?? []
    list.push(job)
    bySource.set(job.payload.sourceId, list)
  }
  return sourceIds.map((sourceId) =>
    itemOf(sourceId, bySource.get(sourceId) ?? []),
  )
}
