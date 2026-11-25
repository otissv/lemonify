import { usePipelineStore, workflowSession } from '@/store/pipeline-store'

interface WorkflowNoticesProps {
  workflowId: string
}

/** What about a workflow's edits needs attention: why the last change could not be saved. Undo and Redo are in the Edit menu and on the keys. */
export function WorkflowNotices({
  workflowId,
}: WorkflowNoticesProps): React.JSX.Element | null {
  const error = usePipelineStore(
    (state) => workflowSession(state, workflowId)?.error,
  )

  if (error === undefined) return null

  return (
    <p
      role="alert"
      className="absolute top-3 right-3 z-10 max-w-96 rounded-lg border border-border bg-card p-2 text-caption text-destructive shadow-xs"
    >
      Not saved: {error}
    </p>
  )
}
