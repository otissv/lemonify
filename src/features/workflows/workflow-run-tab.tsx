import {
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiPlayLine,
} from '@remixicon/react'

import { Button } from '@/components/ui/button'
import { canRedoNow, canUndoNow } from '@/features/pipeline/pipeline-session'
import { redoEdit, undoEdit } from '@/features/pipeline/pipeline-sync'
import { RunCanvasSelect } from '@/features/workflows/run-canvas-select'
import { RunsPanel } from '@/features/workflows/runs-panel'
import type { RunCanvasMode } from '@/features/workflows/workflow'
import { usePipelineStore, workflowSession } from '@/store/pipeline-store'

interface WorkflowRunTabProps {
  workflowId: string
  canvasMode: RunCanvasMode
  onCanvasModeChange: (mode: RunCanvasMode) => void
  onRun: () => void
}

/** Starting the workflow, which canvas it draws on, its Edit history and the runs so far. Every change to the workflow is saved as it is made, and a run starts after the last save. */
export function WorkflowRunTab({
  workflowId,
  canvasMode,
  onCanvasModeChange,
  onRun,
}: WorkflowRunTabProps): React.JSX.Element {
  const session = usePipelineStore((state) =>
    workflowSession(state, workflowId),
  )
  const saving =
    session !== undefined && (session.syncing || session.pending.length > 0)
  const error = session?.error
  const name = session?.confirmed.name ?? ''

  function handleUndo(): void {
    void undoEdit(workflowId)
  }

  function handleRedo(): void {
    void redoEdit(workflowId)
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 p-4 pb-2">
        <h2 className="truncate text-title-sm">{name}</h2>
        <p
          role="status"
          className={
            error === undefined
              ? 'text-caption text-muted-foreground'
              : 'text-caption text-destructive'
          }
        >
          {error === undefined
            ? saving
              ? 'Saving…'
              : 'Saved'
            : `Not saved: ${error}`}
        </p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={session === undefined || !canUndoNow(session)}
            onClick={handleUndo}
          >
            <RiArrowGoBackLine aria-hidden="true" />
            Undo
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={session === undefined || !canRedoNow(session)}
            onClick={handleRedo}
          >
            <RiArrowGoForwardLine aria-hidden="true" />
            Redo
          </Button>
        </div>
        <RunCanvasSelect value={canvasMode} onChange={onCanvasModeChange} />
        <Button size="sm" onClick={onRun}>
          <RiPlayLine aria-hidden="true" />
          Run
        </Button>
      </div>
      <RunsPanel workflowId={workflowId} />
    </div>
  )
}
