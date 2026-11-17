import { RiImageLine } from '@remixicon/react'
import { useParams } from '@tanstack/react-router'

import { workflowThumbnailImageUrl } from '@/features/documents/image-urls'
import { useWorkflow } from '@/features/workflows/use-workflow'
import { useWorkflowThumbnails } from '@/features/workflows/use-workflow-thumbnails'
import { previewNodeIdForUi } from '@/features/workflows/workflow-selection'
import { RunCanvasMode } from '@/features/workflows/workflow'
import { usePipelineStore } from '@/store/pipeline-store'
import { useUiStore } from '@/store/ui-store'

/** The picture of the workflow's selected diagram node, or the output when none is chosen. */
export function WorkflowSidebarPreview({
  workflowId,
}: {
  workflowId: string
}): React.JSX.Element {
  const { id: openId } = useParams({ strict: false })
  const onPage = openId === workflowId
  useWorkflow(workflowId)
  const canvasMode = useUiStore(
    (state) => state.runCanvasModes[workflowId] ?? RunCanvasMode.Workflow,
  )
  useWorkflowThumbnails(workflowId, canvasMode, !onPage)
  const focus = useUiStore((state) => state.workflowFocus[workflowId])
  const stepId = useUiStore((state) => state.selectedSteps[workflowId])
  const nodeId = previewNodeIdForUi(focus, stepId)
  const thumbnails = usePipelineStore((state) => state.thumbnails[workflowId])
  const key = thumbnails?.find(({ stepId }) => stepId === nodeId)?.key
  const src =
    key === null || key === undefined
      ? undefined
      : workflowThumbnailImageUrl(workflowId, key)

  return (
    <div className="px-2 pb-2 pt-1">
      {src ? (
        <img
          data-slot="workflow-sidebar-preview"
          src={src}
          alt=""
          decoding="async"
          className="aspect-video w-full rounded-sm bg-muted object-cover"
        />
      ) : (
        <span
          data-slot="workflow-sidebar-preview"
          className="flex aspect-video w-full items-center justify-center rounded-sm bg-muted text-muted-foreground"
        >
          <RiImageLine aria-hidden="true" className="size-5" />
        </span>
      )}
    </div>
  )
}