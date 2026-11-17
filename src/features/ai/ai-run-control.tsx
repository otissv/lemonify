import { Button } from '@/components/ui/button'
import {
  cancelAiRun,
  runPendingAiSteps,
} from '@/features/documents/document-render-sync'
import { usePreview } from '@/features/pipeline/use-preview'
import { JobState } from '@/server/jobs/job-types'
import { usePipelineStore } from '@/store/pipeline-store'

interface AiRunControlProps {
  documentId: string
  stepId: string
}

const PERCENT = 100

/**
 * Runs the document's pending AI steps, the selected one and any before it,
 * with progress and Cancel. A step that has a result is not run again.
 */
export function AiRunControl({
  documentId,
  stepId,
}: AiRunControlProps): React.JSX.Element {
  const run = usePipelineStore((state) => state.aiRuns[documentId])
  const preview = usePreview(documentId)
  const active = run !== undefined && run.state !== JobState.Failed
  const outOfDate = preview?.pending.includes(stepId) ?? false
  const percent = Math.round((run?.progress ?? 0) * PERCENT)

  function handleRun(): void {
    void runPendingAiSteps(documentId)
  }

  function handleCancel(): void {
    void cancelAiRun(documentId)
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border p-4">
      {active && (
        <div className="flex items-center gap-3">
          <div
            role="progressbar"
            aria-label="Running the AI step"
            aria-valuemin={0}
            aria-valuemax={PERCENT}
            aria-valuenow={percent}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="w-10 text-right text-caption text-muted-foreground">
            {percent}%
          </span>
          <Button variant="secondary" size="xs" onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      )}
      {run?.state === JobState.Failed && (
        <p role="alert" className="text-caption text-destructive">
          {run.error}
        </p>
      )}
      {outOfDate ? (
        <Button size="sm" disabled={active} onClick={handleRun}>
          Run
        </Button>
      ) : (
        <p role="status" className="text-caption text-muted-foreground">
          {preview ? 'This step has run.' : ''}
        </p>
      )}
    </div>
  )
}
