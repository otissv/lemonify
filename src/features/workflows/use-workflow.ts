import { loadWorkflow } from '@/features/pipeline/pipeline-sync'
import type { WorkflowSession } from '@/features/pipeline/pipeline-session'
import { useLoadPipeline } from '@/features/pipeline/use-load-pipeline'
import { usePipelineStore, workflowSession } from '@/store/pipeline-store'

const LOAD_FAILED = 'The workflow could not be loaded.'

export type UseWorkflow = {
  session: WorkflowSession | undefined
  /** Why the workflow could not be loaded. */
  loadError: string | undefined
}

/** The editor's state of a workflow, read from the server the first time it is asked for, like a document's. */
export function useWorkflow(workflowId: string): UseWorkflow {
  const session = usePipelineStore((state) =>
    workflowSession(state, workflowId),
  )
  const loadError = useLoadPipeline(
    workflowId,
    session !== undefined,
    loadWorkflow,
    LOAD_FAILED,
  )
  return { session, loadError }
}
