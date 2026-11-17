import { Button } from '@/components/ui/button'
import { runPendingAiSteps } from '@/features/documents/document-render-sync'
import { JobState } from '@/server/jobs/job-types'
import { documentSession, usePipelineStore } from '@/store/pipeline-store'

interface EditsNoticesProps {
  documentId: string
  /** Enabled AI steps that have no result yet. */
  pendingRenders: number
  /** Steps left out of the picture because they are not set up. */
  skippedSteps: number
  /** Why the picture could not be made, if it could not. */
  renderError: string | undefined
}

const NOTICE =
  'flex items-center gap-2 rounded-lg border border-border bg-card p-2 text-caption shadow-xs'

/** Things about a document's edits that need the person's attention. */
export function EditsNotices({
  documentId,
  pendingRenders,
  skippedSteps,
  renderError,
}: EditsNoticesProps): React.JSX.Element {
  const error = usePipelineStore(
    (state) => documentSession(state, documentId)?.error,
  )
  const run = usePipelineStore((state) => state.aiRuns[documentId])
  const running = run !== undefined && run.state !== JobState.Failed

  function handleRender(): void {
    void runPendingAiSteps(documentId)
  }

  return (
    <>
      {error !== undefined && (
        <p role="alert" className={`${NOTICE} text-destructive`}>
          {error}
        </p>
      )}
      {renderError !== undefined && (
        <p role="alert" className={`${NOTICE} text-destructive`}>
          {renderError}
        </p>
      )}
      {skippedSteps > 0 && (
        <p role="status" className={NOTICE}>
          {skippedSteps === 1
            ? '1 step is left out until it is set up.'
            : `${skippedSteps} steps are left out until they are set up.`}
        </p>
      )}
      {pendingRenders > 0 && (
        <div role="status" className={NOTICE}>
          <span>
            {pendingRenders === 1
              ? '1 AI step has not been run.'
              : `${pendingRenders} AI steps have not been run.`}
          </span>
          <Button size="xs" disabled={running} onClick={handleRender}>
            Run
          </Button>
        </div>
      )}
    </>
  )
}
