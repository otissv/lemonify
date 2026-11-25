import { RiStopLine } from '@remixicon/react'

import { Button } from '@/components/ui/button'
import { RunProgress } from '@/features/workflows/runs/run-progress'
import { runName, runSummary } from '@/features/workflows/runs/run-text'
import { cn } from '@/lib/utils'
import { RunState } from '@/server/dao/workflow-dao'
import type { RunView } from '@/server/services/workflow-service'

interface RunListProps {
  runs: ReadonlyArray<RunView>
  selectedId: string | undefined
  onSelect: (runId: string) => void
  onStop: (runId: string) => void
}

interface RunRowProps {
  run: RunView
  name: string
  selected: boolean
  onSelect: (runId: string) => void
  onStop: (runId: string) => void
}

function RunRow({
  run,
  name,
  selected,
  onSelect,
  onStop,
}: RunRowProps): React.JSX.Element {
  function handleSelect(): void {
    onSelect(run.id)
  }

  function handleStop(): void {
    onStop(run.id)
  }

  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={handleSelect}
        className={cn(
          'flex min-w-0 flex-1 flex-col gap-1 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
          selected && 'bg-accent',
        )}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-body-md">{name}</span>
          <span className="text-caption text-muted-foreground">
            {runSummary(run)}
          </span>
        </span>
        <RunProgress run={run} />
      </button>
      {run.state === RunState.Running && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Stop ${name}`}
          onClick={handleStop}
        >
          <RiStopLine aria-hidden="true" />
        </Button>
      )}
    </li>
  )
}

/** The runs of a workflow, newest first, one row each with how far it has got. */
export function RunList({
  runs,
  selectedId,
  onSelect,
  onStop,
}: RunListProps): React.JSX.Element {
  return (
    <ul aria-label="Runs" className="flex flex-col gap-0.5">
      {runs.map((run, index) => (
        <RunRow
          key={run.id}
          run={run}
          name={runName(index, runs.length)}
          selected={run.id === selectedId}
          onSelect={onSelect}
          onStop={onStop}
        />
      ))}
    </ul>
  )
}
