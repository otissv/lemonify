import { Canvas } from '@/features/documents/canvas'
import {
  ActualSizeButton,
  FitButton,
  PanButtons,
  ViewToolbar,
  ViewToolbarDivider,
} from '@/features/viewport/view-toolbar'
import { ZoomControl } from '@/features/viewport/zoom-control'
import {
  NodePreviewStatus,
  useWorkflowNodePreview,
} from '@/features/workflows/use-workflow-node-preview'
import type { NodePreview } from '@/features/workflows/use-workflow-node-preview'
import { cn } from '@/lib/utils'

interface WorkflowNodePreviewProps {
  workflowId: string
  /** The diagram node whose picture is shown: a step, or the canvas, inputs or output. */
  nodeId: string
  /** What the picture is of, for its text alternative. */
  name: string
}

const NO_PICTURE = 'This step has no picture yet.'

function PreviewNotice({
  preview,
  over,
}: {
  preview: NodePreview
  /** A picture is shown under the notice, so it sits in a corner instead of the middle. */
  over: boolean
}): React.JSX.Element | null {
  const placed = over
    ? 'absolute top-2 left-2 rounded-sm bg-background/80 px-2 py-1 text-body-sm'
    : 'absolute inset-0 flex items-center justify-center p-6 text-center text-body-md'
  switch (preview.status) {
    case NodePreviewStatus.Ready:
      return null
    case NodePreviewStatus.Rendering:
      return (
        <p role="status" className={cn(placed, 'text-muted-foreground')}>
          Rendering…
        </p>
      )
    case NodePreviewStatus.None:
      return <p className={cn(placed, 'text-muted-foreground')}>{NO_PICTURE}</p>
    case NodePreviewStatus.Failed:
      return (
        <p role="alert" className={cn(placed, 'text-destructive')}>
          {preview.error}
        </p>
      )
  }
}

/**
 * The large picture of one workflow diagram node, on the same canvas a
 * document is edited on, so it can be zoomed and moved around. The last
 * picture stays while the next one renders.
 */
export function WorkflowNodePreview({
  workflowId,
  nodeId,
  name,
}: WorkflowNodePreviewProps): React.JSX.Element {
  const preview = useWorkflowNodePreview(workflowId, nodeId)
  const { picture } = preview

  return (
    <div data-slot="workflow-node-preview" className="flex size-full flex-col">
      <div className="relative min-h-0 flex-1">
        {picture !== undefined && (
          <Canvas
            id={workflowId}
            url={picture.url}
            name={name}
            width={picture.width}
            height={picture.height}
          />
        )}
        <PreviewNotice preview={preview} over={picture !== undefined} />
      </div>
      <ViewToolbar label="Preview view">
        <ZoomControl documentId={workflowId} className="w-56" />
        <ViewToolbarDivider />
        <FitButton documentId={workflowId} />
        <ActualSizeButton documentId={workflowId} />
        <ViewToolbarDivider />
        <PanButtons documentId={workflowId} />
      </ViewToolbar>
    </div>
  )
}
