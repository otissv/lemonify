import { RunState } from '@/server/dao/workflow-dao'
import type { RunView } from '@/server/services/workflow-service'
import { RunItemState } from '@/server/workflows/run-items'

export const ITEM_STATE_LABELS: Readonly<Record<RunItemState, string>> = {
  [RunItemState.Waiting]: 'Waiting',
  [RunItemState.Running]: 'Working',
  [RunItemState.Done]: 'Done',
  [RunItemState.Failed]: 'Failed',
  [RunItemState.Cancelled]: 'Stopped',
}

/** How many of a run's images are in each state. */
export function itemCounts(
  run: RunView,
): Readonly<Record<RunItemState, number>> {
  const counts: Record<RunItemState, number> = {
    [RunItemState.Waiting]: 0,
    [RunItemState.Running]: 0,
    [RunItemState.Done]: 0,
    [RunItemState.Failed]: 0,
    [RunItemState.Cancelled]: 0,
  }
  for (const item of run.items) counts[item.state] += 1
  return counts
}

/** How far a run has got, in a few words: "1 of 3 done", "2 done, 1 failed" or "Stopped at 1 of 3". */
export function runSummary(run: RunView): string {
  const counts = itemCounts(run)
  const done = counts[RunItemState.Done]
  const total = run.items.length
  switch (run.state) {
    case RunState.Running:
      return `${done} of ${total} done`
    case RunState.Cancelled:
      return `Stopped at ${done} of ${total}`
    default: {
      const failed = counts[RunItemState.Failed]
      return failed === 0 ? `${done} done` : `${done} done, ${failed} failed`
    }
  }
}

/** A run's name in the list, counting from the oldest: the newest of three is "Run 3". */
export function runName(index: number, count: number): string {
  return `Run ${count - index}`
}

/** The images of `wanted` the workflow still takes as inputs, in the order of `wanted`. */
export function stillInputs(
  wanted: ReadonlyArray<string>,
  inputs: ReadonlyArray<string>,
): string[] {
  const present = new Set(inputs)
  return wanted.filter((sourceId) => present.has(sourceId))
}

export function imageCount(count: number): string {
  return count === 1 ? '1 image' : `${count} images`
}
