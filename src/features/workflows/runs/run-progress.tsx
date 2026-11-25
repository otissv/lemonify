import { itemCounts } from '@/features/workflows/runs/run-text'
import type { RunView } from '@/server/services/workflow-service'
import { RunItemState } from '@/server/workflows/run-items'

interface RunProgressProps {
  run: RunView
  /** The bar's name; none when the text beside it already says how far the run has got. */
  label?: string
}

/** A bar of how many of a run's images are done. */
export function RunProgress({
  run,
  label,
}: RunProgressProps): React.JSX.Element {
  return (
    <progress
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      className="h-1 w-full accent-primary"
      max={Math.max(run.items.length, 1)}
      value={itemCounts(run)[RunItemState.Done]}
    />
  )
}
