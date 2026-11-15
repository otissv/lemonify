import '@xyflow/react/dist/style.css'

import { Background, Controls, ReactFlow } from '@xyflow/react'
import type {
  Connection,
  Dimensions,
  Edge,
  EdgeChange,
  NodeChange,
} from '@xyflow/react'
import { useCallback, useMemo, useState } from 'react'

import { StepNode } from '@/features/workflows/step-node'
import type { StepFlowNode } from '@/features/workflows/step-node'
import type { Workflow } from '@/features/workflows/workflow'
import { canConnect, removeStep } from '@/features/workflows/workflow-graph'
import type { WorkflowEdge } from '@/features/workflows/workflow-graph'
import {
  isEndpoint,
  stepLabel,
  stepSummary,
} from '@/features/workflows/workflow-steps'

type WorkflowUpdate = (update: (workflow: Workflow) => Workflow) => void

interface WorkflowCanvasProps {
  workflow: Workflow
  selectedId: string | null
  onSelect: (id: string | null) => void
  onUpdate: WorkflowUpdate
}

interface NodeChangeContext {
  onUpdate: WorkflowUpdate
  setMeasured: React.Dispatch<
    React.SetStateAction<Readonly<Record<string, Dimensions | undefined>>>
  >
}

const NODE_TYPES = { step: StepNode }
const PRO_OPTIONS = { hideAttribution: true }
const FIT_VIEW_OPTIONS = { padding: 0.3, maxZoom: 1 }

function moveNode(
  workflow: Workflow,
  id: string,
  x: number,
  y: number,
): Workflow {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) =>
      node.id === id ? { ...node, position: { x, y } } : node,
    ),
  }
}

function withoutEdge(workflow: Workflow, id: string): Workflow {
  return { ...workflow, edges: workflow.edges.filter((edge) => edge.id !== id) }
}

function toFlowNodes(
  workflow: Workflow,
  selectedId: string | null,
  measured: Readonly<Record<string, Dimensions | undefined>>,
): Array<StepFlowNode> {
  return workflow.nodes.map((node) => ({
    id: node.id,
    type: 'step',
    position: node.position,
    data: {
      label: stepLabel(node),
      summary: stepSummary(node),
      kind: node.kind,
    },
    selected: node.id === selectedId,
    deletable: !isEndpoint(node),
    measured: measured[node.id],
  }))
}

function toFlowEdges(
  edges: ReadonlyArray<WorkflowEdge>,
  selectedEdges: ReadonlySet<string>,
): Array<Edge> {
  return edges.map((edge) => ({
    ...edge,
    selected: selectedEdges.has(edge.id),
  }))
}

/**
 * The selected step after one change. React Flow reports a new selection and
 * the old one's deselection in one batch, in any order, so the batch is
 * folded rather than applied change by change.
 */
function selectionAfter(
  selection: string | null,
  change: NodeChange<StepFlowNode>,
): string | null {
  if (change.type === 'select' && change.selected) return change.id
  const leaves =
    (change.type === 'select' || change.type === 'remove') &&
    change.id === selection
  return leaves ? null : selection
}

function applyNodeChange(
  change: NodeChange<StepFlowNode>,
  { onUpdate, setMeasured }: NodeChangeContext,
): void {
  switch (change.type) {
    case 'dimensions': {
      const { dimensions } = change
      if (dimensions)
        setMeasured((all) => ({ ...all, [change.id]: dimensions }))
      return
    }
    case 'position': {
      const { position } = change
      if (position)
        onUpdate((current) =>
          moveNode(current, change.id, position.x, position.y),
        )
      return
    }
    case 'remove':
      onUpdate((current) => removeStep(current, change.id))
      return
    case 'select':
    case 'add':
    case 'replace':
      return
  }
}

/** The pipeline drawn as connected steps; drag to arrange, drag between handles to connect. */
export function WorkflowCanvas({
  workflow,
  selectedId,
  onSelect,
  onUpdate,
}: WorkflowCanvasProps): React.JSX.Element {
  const [measured, setMeasured] = useState<
    Readonly<Record<string, Dimensions | undefined>>
  >({})
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<string>>(
    new Set(),
  )

  const nodes = useMemo(
    () => toFlowNodes(workflow, selectedId, measured),
    [workflow, selectedId, measured],
  )
  const edges = useMemo(
    () => toFlowEdges(workflow.edges, selectedEdges),
    [workflow.edges, selectedEdges],
  )

  const handleNodesChange = useCallback(
    (changes: Array<NodeChange<StepFlowNode>>): void => {
      const context = { onUpdate, setMeasured }
      let selection = selectedId
      for (const change of changes) {
        selection = selectionAfter(selection, change)
        applyNodeChange(change, context)
      }
      if (selection !== selectedId) onSelect(selection)
    },
    [onSelect, onUpdate, selectedId],
  )

  const handleEdgesChange = useCallback(
    (changes: Array<EdgeChange>): void => {
      for (const change of changes) {
        if (change.type === 'remove')
          onUpdate((current) => withoutEdge(current, change.id))
        if (change.type === 'select')
          setSelectedEdges((all) => toggled(all, change.id, change.selected))
      }
    },
    [onUpdate],
  )

  const isValidConnection = useCallback(
    (connection: Edge | Connection): boolean =>
      canConnect(workflow, connection.source, connection.target),
    [workflow],
  )

  const handleConnect = useCallback(
    (connection: Connection): void => {
      onUpdate((current) => {
        if (!canConnect(current, connection.source, connection.target))
          return current
        const edge = {
          id: crypto.randomUUID(),
          source: connection.source,
          target: connection.target,
        }
        return { ...current, edges: [...current.edges, edge] }
      })
    },
    [onUpdate],
  )

  return (
    <div
      role="application"
      aria-label="Workflow canvas"
      className="relative min-w-0 flex-1"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        colorMode="dark"
        fitView
        selectNodesOnDrag={false}
        fitViewOptions={FIT_VIEW_OPTIONS}
        proOptions={PRO_OPTIONS}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        isValidConnection={isValidConnection}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

function toggled(
  set: ReadonlySet<string>,
  id: string,
  on: boolean,
): ReadonlySet<string> {
  const next = new Set(set)
  if (on) next.add(id)
  else next.delete(id)
  return next
}
