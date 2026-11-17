import { useEffect } from 'react'

import { refreshWorkflowThumbnails } from '@/features/workflows/workflow-render-sync'
import type { RunCanvasMode } from '@/features/workflows/workflow'
import { usePipelineStore, workflowSession } from '@/store/pipeline-store'

export const WORKFLOW_THUMBNAIL_DELAY_MS = 300

/** Keeps workflow diagram thumbnails up to date while a preview is shown. */
export function useWorkflowThumbnails(
  workflowId: string,
  canvasMode: RunCanvasMode,
  active: boolean,
): void {
  const revision = usePipelineStore(
    (state) => workflowSession(state, workflowId)?.confirmed.revision,
  )
  const pending = usePipelineStore(
    (state) => workflowSession(state, workflowId)?.pending.length ?? 0,
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision, canvas mode and pending retrigger the ask
  useEffect(() => {
    if (!active || revision === undefined) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const session = workflowSession(usePipelineStore.getState(), workflowId)
      if (session === undefined || session.pending.length > 0) return
      void refreshWorkflowThumbnails(workflowId, canvasMode, controller.signal)
    }, WORKFLOW_THUMBNAIL_DELAY_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [workflowId, canvasMode, active, revision, pending])
}