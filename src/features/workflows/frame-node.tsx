import { RiDeleteBinLine } from '@remixicon/react'
import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type FrameNodeData = {
  label: string
  summary: string
  enabled: boolean
  /** Whether the line runs through the frame itself, which it does when it holds no steps. */
  onLine: boolean
  onDelete?: (stepId: string) => void
}

export type FrameFlowNode = Node<FrameNodeData, 'frame'>

/** A group or an embedded document layer on the diagram: a frame drawn around its steps, which sit inside it. */
export function FrameNode({
  id,
  data,
  selected,
}: NodeProps<FrameFlowNode>): React.JSX.Element {
  function handleDelete(event: React.MouseEvent): void {
    event.stopPropagation()
    data.onDelete?.(id)
  }

  return (
    <div
      data-slot="workflow-frame"
      className={cn(
        'relative size-full rounded-lg border border-dashed bg-card/40 px-4 py-3 text-card-foreground',
        selected ? 'border-ring' : 'border-border',
        !data.enabled && 'opacity-60',
      )}
    >
      {data.onLine && <Handle id="in" type="target" position={Position.Left} />}
      {data.onDelete !== undefined && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="nodrag nopan absolute top-1 right-1 text-muted-foreground"
          aria-label={`Delete ${data.label}`}
          title={`Delete ${data.label}`}
          onClick={handleDelete}
        >
          <RiDeleteBinLine aria-hidden="true" className="size-4" />
        </Button>
      )}
      <div className="flex flex-col gap-0.5 pr-7">
        <span className="truncate text-label-md">{data.label}</span>
        <span className="truncate text-caption text-muted-foreground">
          {data.summary}
        </span>
      </div>
      {data.onLine && (
        <Handle id="out" type="source" position={Position.Right} />
      )}
    </div>
  )
}
