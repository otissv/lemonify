import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'

import { cn } from '@/lib/utils'

export type StepNodeData = {
  label: string
  summary: string
  enabled: boolean
  /** Whether the node is the start of the line, the end of it, or a step between. */
  position: 'start' | 'middle' | 'end'
  /** Whether a branch hangs from the bottom of the node, or hangs it from the top. */
  hasBranch: boolean
  inBranch: boolean
}

export type StepFlowNode = Node<StepNodeData, 'step'>

/** One thing in the workflow: the canvas, the input images, a step, or the output. */
export function StepNode({
  data,
  selected,
}: NodeProps<StepFlowNode>): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex w-52 flex-col gap-1 rounded-lg border bg-card px-4 py-3 text-card-foreground shadow-xs',
        selected ? 'border-ring' : 'border-border',
        !data.enabled && 'opacity-60',
      )}
    >
      {data.position !== 'start' && (
        <Handle id="in" type="target" position={Position.Left} />
      )}
      {data.inBranch && (
        <Handle id="top" type="target" position={Position.Top} />
      )}
      <span className="text-label-md">{data.label}</span>
      <span className="truncate text-caption text-muted-foreground">
        {data.summary}
      </span>
      {data.position !== 'end' && (
        <Handle id="out" type="source" position={Position.Right} />
      )}
      {data.hasBranch && (
        <Handle id="bottom" type="source" position={Position.Bottom} />
      )}
    </div>
  )
}
