import { RiAddLine } from '@remixicon/react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { NewRunPicker } from '@/features/workflows/runs/new-run-picker'
import { RunDetail } from '@/features/workflows/runs/run-detail'
import { RunList } from '@/features/workflows/runs/run-list'
import { runName } from '@/features/workflows/runs/run-text'
import type { RunView } from '@/server/services/workflow-service'
import { useLibraryStore } from '@/store/library-store'

interface RunsPanelProps {
  workflowId: string
  /** The workflow's input images, which a run can go over. */
  inputs: ReadonlyArray<string>
  imageName: (sourceId: string) => string
  /** Starts a run over these images once the workflow is saved. */
  onRun: (sourceIds: string[]) => Promise<void>
}

/** What the panel shows: a new run being set up, one run, or the newest run. */
type Shown = { kind: 'new' } | { kind: 'run'; id: string } | { kind: 'latest' }

const NO_RUNS: ReadonlyArray<RunView> = []
const LATEST: Shown = { kind: 'latest' }

function shownRun(runs: ReadonlyArray<RunView>, shown: Shown): number {
  if (shown.kind === 'new') return -1
  if (shown.kind === 'latest') return runs.length === 0 ? -1 : 0
  const index = runs.findIndex((run) => run.id === shown.id)
  return index === -1 && runs.length > 0 ? 0 : index
}

/**
 * The runs of a workflow beside its diagram: starting a run over chosen input
 * images, the runs so far with how far each has got, and the selected run's
 * images and downloads. With no runs yet it opens on choosing images.
 */
export function RunsPanel({
  workflowId,
  inputs,
  imageName,
  onRun,
}: RunsPanelProps): React.JSX.Element {
  const runs = useLibraryStore((state) => state.runs[workflowId]) ?? NO_RUNS
  const error = useLibraryStore((state) => state.runErrors[workflowId])
  const cancelRun = useLibraryStore((state) => state.cancelRun)
  const removeRun = useLibraryStore((state) => state.removeRun)
  const [shown, setShown] = useState<Shown>(LATEST)
  const index = shownRun(runs, shown)
  const run = runs[index]

  function handleRun(sourceIds: string[]): void {
    void onRun(sourceIds).then(() => setShown(LATEST))
  }

  function handleNew(): void {
    setShown({ kind: 'new' })
  }

  function handleCancel(): void {
    setShown(LATEST)
  }

  function handleSelect(runId: string): void {
    setShown({ kind: 'run', id: runId })
  }

  function handleStop(runId: string): void {
    void cancelRun(workflowId, runId)
  }

  function handleDelete(runId: string): void {
    void removeRun(workflowId, runId)
  }

  return (
    <div className="flex size-full min-h-0 flex-col gap-3 overflow-y-auto p-4">
      {error !== undefined && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
      {runs.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <h2 className="text-title-sm">Runs</h2>
            <Button variant="ghost" size="sm" onClick={handleNew}>
              <RiAddLine aria-hidden="true" />
              New run
            </Button>
          </div>
          <RunList
            runs={runs}
            selectedId={run?.id}
            onSelect={handleSelect}
            onStop={handleStop}
          />
        </div>
      )}
      {run === undefined ? (
        <NewRunPicker
          inputs={inputs}
          imageName={imageName}
          onRun={handleRun}
          onCancel={runs.length > 0 ? handleCancel : undefined}
        />
      ) : (
        <RunDetail
          run={run}
          name={runName(index, runs.length)}
          inputs={inputs}
          imageName={imageName}
          onRun={handleRun}
          onStop={handleStop}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
