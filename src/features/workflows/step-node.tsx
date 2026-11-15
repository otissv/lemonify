import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'

import { cn } from '@/lib/utils'
import { WorkflowNodeKind } from '@/features/workflows/workflow-graph'
import type { WorkflowNode } from '@/features/workflows/workflow-graph'

export type StepNodeData = {
  label: string
  summary: string
  kind: WorkflowNode['kind']
}

export type StepFlowNode = Node<StepNodeData, 'step'>

/** A pipeline step on the canvas. Input has no way in and Output no way out. */
export function StepNode({
  data,
  selected,
}: NodeProps<StepFlowNode>): React.JSX.Element {
  const takesInput = data.kind !== WorkflowNodeKind.Input
  const givesOutput = data.kind !== WorkflowNodeKind.Output

  return (
    <div
      className={cn(
        'flex w-52 flex-col gap-1 rounded-lg border bg-card px-4 py-3 text-card-foreground shadow-xs',
        selected ? 'border-ring' : 'border-border',
      )}
    >
      {takesInput && (
        <Handle
          type="target"
          position={Position.Left}
          aria-label={`Into ${data.label}`}
        />
      )}
      <span className="text-label-md">{data.label}</span>
      <span className="truncate text-caption text-muted-foreground">
        {data.summary}
      </span>
      {givesOutput && (
        <Handle
          type="source"
          position={Position.Right}
          aria-label={`Out of ${data.label}`}
        />
      )}
    </div>
  )
}
