import { followJob } from '@/features/jobs/follow-job'
import {
  requestWorkflowPreview,
  requestWorkflowThumbnails,
} from '@/features/render/render-functions'
import { errorMessage } from '@/lib/error-message'
import { JobKind, JobState } from '@/server/jobs/job-types'
import type { RunCanvasMode } from '@/features/workflows/workflow'
import { usePipelineStore } from '@/store/pipeline-store'

const PREVIEW_FAILED = 'The picture could not be made.'

/** What became of asking for a node's large picture: the render and its size, none when the node's steps cannot make one, or why it failed. */
export type NodePreviewOutcome =
  | { kind: 'picture'; key: string; width: number; height: number }
  | { kind: 'none' }
  | { kind: 'failed'; error: string }

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

/** Asks for the large picture of one workflow diagram node and waits for it. Undefined when `signal` aborted first. */
export async function loadWorkflowNodePreview(
  workflowId: string,
  canvasMode: RunCanvasMode,
  nodeId: string,
  signal: AbortSignal,
): Promise<NodePreviewOutcome | undefined> {
  try {
    const queued = await requestWorkflowPreview({
      data: { workflowId, canvasMode, nodeId },
    })
    const ended = await followJob(queued.id, signal)
    if (ended === undefined) return undefined
    const result = ended.result
    if (
      ended.state !== JobState.Done ||
      result?.kind !== JobKind.WorkflowPreview
    ) {
      return { kind: 'failed', error: ended.error ?? PREVIEW_FAILED }
    }
    return result.picture === null
      ? { kind: 'none' }
      : { kind: 'picture', ...result.picture }
  } catch (error) {
    if (signal.aborted) return undefined
    return { kind: 'failed', error: errorMessage(error, PREVIEW_FAILED) }
  }
}
