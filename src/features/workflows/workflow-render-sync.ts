import { followJob } from '@/features/jobs/follow-job'
import { requestWorkflowThumbnails } from '@/features/render/render-functions'
import { JobKind, JobState } from '@/server/jobs/job-types'
import type { RunCanvasMode } from '@/features/workflows/workflow'
import { usePipelineStore } from '@/store/pipeline-store'

/** Asks for small pictures under each workflow node; a node without one is left empty. */
export async function refreshWorkflowThumbnails(
  workflowId: string,
  canvasMode: RunCanvasMode,
  signal: AbortSignal,
): Promise<void> {
  try {
    const queued = await requestWorkflowThumbnails({
      data: { workflowId, canvasMode },
    })
    const ended = await followJob(queued.id, signal)
    const result = ended?.result
    if (
      ended?.state !== JobState.Done ||
      result?.kind !== JobKind.WorkflowThumbnail
    ) {
      return
    }
    usePipelineStore.getState().setThumbnails(workflowId, result.thumbnails)
  } catch {
    if (signal.aborted) return
  }
}