import { describe, expect, it } from 'vitest'

import { JobKind, JobState } from '../jobs/job-types.ts'
import type { JobRecord } from '../jobs/job-types.ts'
import { RunItemState, runItems } from './run-items.ts'

let next = 0

function job(
  sourceId: string,
  segment: number,
  state: JobState,
  resultIds: string[] = [],
): JobRecord {
  next += 1
  return {
    id: `job-${next}`,
    kind: JobKind.RunItem,
    payload: { kind: JobKind.RunItem, workflowRunId: 'run', sourceId, segment },
    state,
    result:
      state === JobState.Done ? { kind: JobKind.RunItem, resultIds } : null,
  } as unknown as JobRecord
}

describe('runItems', () => {
  it('gives each chosen image, in order, the state of its work so far', () => {
    const items = runItems(
      ['a', 'b', 'c', 'd', 'e'],
      [
        job('a', 0, JobState.Done, ['r1', 'r2']),
        job('b', 0, JobState.Done),
        job('b', 1, JobState.Running),
        job('c', 0, JobState.Failed),
        job('d', 0, JobState.Cancelled),
      ],
    )

    expect(items).toEqual([
      { sourceId: 'a', state: RunItemState.Done, resultIds: ['r1', 'r2'] },
      { sourceId: 'b', state: RunItemState.Running, resultIds: [] },
      { sourceId: 'c', state: RunItemState.Failed, resultIds: [] },
      { sourceId: 'd', state: RunItemState.Cancelled, resultIds: [] },
      { sourceId: 'e', state: RunItemState.Waiting, resultIds: [] },
    ])
  })

  it('keeps an image waiting between steps, until its last step has made its files', () => {
    const [item] = runItems(['a'], [job('a', 0, JobState.Done)])

    expect(item?.state).toBe(RunItemState.Waiting)
  })
})
