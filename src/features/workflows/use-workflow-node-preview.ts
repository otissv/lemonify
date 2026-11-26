import { useEffect, useState } from 'react'

import { workflowPreviewImageUrl } from '@/features/documents/image-urls'
import { loadWorkflowNodePreview } from '@/features/workflows/workflow-render-sync'
import type { NodePreviewOutcome } from '@/features/workflows/workflow-render-sync'
import { usePipelineStore, workflowSession } from '@/store/pipeline-store'

/** How long edits settle before the picture is asked for, so a burst of changes renders once. */
export const WORKFLOW_NODE_PREVIEW_DELAY_MS = 120

export enum NodePreviewStatus {
  Rendering = 'rendering',
  Ready = 'ready',
  /** The node's steps cannot make a picture, such as when an image layer has no image. */
  None = 'none',
  Failed = 'failed',
}

export interface NodePreview {
  status: NodePreviewStatus
  /** The last picture made, kept while the next one renders. */
  picture: { url: string; width: number; height: number } | undefined
  error: string | undefined
}

const INITIAL: NodePreview = {
  status: NodePreviewStatus.Rendering,
  picture: undefined,
  error: undefined,
}

/** The preview after an answer from the server; a failure keeps the last picture. */
function previewAfter(
  current: NodePreview,
  outcome: NodePreviewOutcome,
  workflowId: string,
): NodePreview {
  switch (outcome.kind) {
    case 'picture':
      return {
        status: NodePreviewStatus.Ready,
        picture: {
          url: workflowPreviewImageUrl(workflowId, outcome.key),
          width: outcome.width,
          height: outcome.height,
        },
        error: undefined,
      }
    case 'none':
      return {
        status: NodePreviewStatus.None,
        picture: undefined,
        error: undefined,
      }
    case 'failed':
      return {
        ...current,
        status: NodePreviewStatus.Failed,
        error: outcome.error,
      }
  }
}

/**
 * The large picture of a workflow diagram node, asked for again shortly after
 * the server confirms each change, when the node changes, and when a
 * document or workflow its layers use changed.
 */
export function useWorkflowNodePreview(
  workflowId: string,
  nodeId: string,
): NodePreview {
  const [preview, setPreview] = useState<NodePreview>(INITIAL)
  const revision = usePipelineStore(
    (state) => workflowSession(state, workflowId)?.confirmed.revision,
  )
  const pictureVersion = usePipelineStore(
    (state) => state.pictureVersions[workflowId],
  )
  const pending = usePipelineStore(
    (state) => workflowSession(state, workflowId)?.pending.length ?? 0,
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: a change to what layers use makes the picture ask again
  useEffect(() => {
    if (revision === undefined || pending > 0) return
    const controller = new AbortController()
    setPreview((current) => ({
      ...current,
      status: NodePreviewStatus.Rendering,
    }))
    const timer = setTimeout(() => {
      void (async () => {
        const outcome = await loadWorkflowNodePreview(
          workflowId,
          nodeId,
          controller.signal,
        )
        if (outcome === undefined || controller.signal.aborted) return
        setPreview((current) => previewAfter(current, outcome, workflowId))
      })()
    }, WORKFLOW_NODE_PREVIEW_DELAY_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [workflowId, nodeId, revision, pending, pictureVersion])

  return preview
}
