import '@xyflow/react/dist/style.css'

import { Background, Controls, ReactFlow } from '@xyflow/react'
import type { Edge } from '@xyflow/react'
import { useCallback, useMemo } from 'react'

import { workflowThumbnailImageUrl } from '@/features/documents/image-urls'
import { usePipelineStore } from '@/store/pipeline-store'

import { PipelineStepKind, findStep } from '@/features/pipeline/pipeline'
import { StepNode } from '@/features/workflows/step-node'
import type { StepFlowNode } from '@/features/workflows/step-node'
import type { Workflow } from '@/features/workflows/workflow'
import {
  CANVAS_NODE_ID,
  INPUTS_NODE_ID,
  OUTPUT_NODE_ID,
  workflowGraph,
} from '@/features/workflows/workflow-graph-layout'
import type {
  GraphEdge,
  GraphNode,
} from '@/features/workflows/workflow-graph-layout'
import {
  CANVAS_SELECTION,
  INPUTS_SELECTION,
  NO_SELECTION,
  OUTPUT_SELECTION,
  selectedStepId,
  stepSelection,
} from '@/features/workflows/workflow-selection'
import type { Selection } from '@/features/workflows/workflow-selection'
import {
  inputsSummary,
  outputSummary,
  stepLabel,
  stepSummary,
} from '@/features/workflows/workflow-steps'

interface WorkflowCanvasProps {
  workflow: Workflow
  selection: Selection
  onSelect: (selection: Selection) => void
  onRemoveStep: (stepId: string) => void
  /** The file name of an image, for the layers that draw one. */
  imageName: (sourceId: string) => string
}

const NODE_TYPES = { step: StepNode }
const PRO_OPTIONS = { hideAttribution: true }
const FIT_VIEW_OPTIONS = { padding: 0.3, maxZoom: 1 }

function selectionOf(nodeId: string): Selection {
  switch (nodeId) {
    case CANVAS_NODE_ID:
      return CANVAS_SELECTION
    case INPUTS_NODE_ID:
      return INPUTS_SELECTION
    case OUTPUT_NODE_ID:
      return OUTPUT_SELECTION
    default:
      return stepSelection(nodeId)
  }
}

function describe(
  workflow: Workflow,
  node: GraphNode,
  imageName: (sourceId: string) => string,
): { label: string; summary: string; enabled: boolean } {
  switch (node.kind) {
    case 'canvas': {
      const { width, height, background } = workflow.pipeline.canvas
      return {
        label: 'Canvas',
        summary: `${width} × ${height} px · ${background}`,
        enabled: true,
      }
    }
    case 'inputs':
      return {
        label: 'Input images',
        summary: inputsSummary(workflow.inputs.length),
        enabled: true,
      }
    case 'output':
      return {
        label: 'Output',
        summary: outputSummary(workflow.output),
        enabled: true,
      }
    case 'step': {
      const step = findStep(workflow.pipeline, node.id)?.step
      if (step === undefined) return { label: '', summary: '', enabled: false }
      return {
        label: stepLabel(step),
        summary: stepSummary(step, imageName),
        enabled: step.enabled,
      }
    }
  }
}

function thumbnailOf(
  workflowId: string,
  nodeId: string,
  thumbnails:
    | ReadonlyArray<{ stepId: string; key: string | null }>
    | undefined,
): string | undefined {
  const key = thumbnails?.find(({ stepId }) => stepId === nodeId)?.key
  return key === null || key === undefined
    ? undefined
    : workflowThumbnailImageUrl(workflowId, key)
}

function toFlowNodes(
  workflow: Workflow,
  workflowId: string,
  nodes: ReadonlyArray<GraphNode>,
  selection: Selection,
  imageName: (sourceId: string) => string,
  thumbnails:
    | ReadonlyArray<{ stepId: string; key: string | null }>
    | undefined,
  onRemoveStep: (stepId: string) => void,
): StepFlowNode[] {
  const groupIds = new Set(
    workflow.pipeline.steps
      .filter(({ kind }) => kind === PipelineStepKind.Group)
      .map(({ id }) => id),
  )
  const chosen = selectedStepId(selection)
  return nodes.map((node) => ({
    id: node.id,
    type: 'step',
    position: { x: node.x, y: node.y },
    draggable: false,
    connectable: false,
    deletable: false,
    selected: selectionIsNode(selection, node, chosen),
    data: {
      ...describe(workflow, node, imageName),
      thumbnail: thumbnailOf(workflowId, node.id, thumbnails),
      position:
        node.kind === 'canvas'
          ? 'start'
          : node.kind === 'output'
            ? 'end'
            : 'middle',
      hasBranch: groupIds.has(node.id),
      inBranch: node.groupId !== undefined,
      deletable: node.kind === 'step',
      onDelete: node.kind === 'step' ? onRemoveStep : undefined,
    },
  }))
}

function selectionIsNode(
  selection: Selection,
  node: GraphNode,
  chosen: string | null,
): boolean {
  switch (selection.kind) {
    case 'none':
      return false
    case 'canvas':
      return node.kind === 'canvas'
    case 'inputs':
      return node.kind === 'inputs'
    case 'output':
      return node.kind === 'output'
    case 'step':
      return node.id === chosen
  }
}

function toFlowEdges(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
): Edge[] {
  const parents = new Map(nodes.map((node) => [node.id, node.groupId]))
  return edges.map((edge) => {
    const hangs = parents.get(edge.target) === edge.source
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: hangs ? 'bottom' : 'out',
      targetHandle: hangs ? 'top' : 'in',
      className: edge.branch ? 'workflow-branch' : undefined,
      style: edge.branch ? { strokeDasharray: '6 4' } : undefined,
    }
  })
}

/** The workflow as a diagram: the line of steps from the canvas to the output, with the steps of a group hanging under it as a branch. Select a node to see its options in the panel; steps are added and changed there. */
export function WorkflowCanvas({
  workflow,
  selection,
  onSelect,
  onRemoveStep,
  imageName,
}: WorkflowCanvasProps): React.JSX.Element {
  const thumbnails = usePipelineStore((state) => state.thumbnails[workflow.id])
  const graph = useMemo(() => workflowGraph(workflow), [workflow])
  const nodes = useMemo(
    () =>
      toFlowNodes(
        workflow,
        workflow.id,
        graph.nodes,
        selection,
        imageName,
        thumbnails,
        onRemoveStep,
      ),
    [workflow, graph.nodes, selection, imageName, thumbnails, onRemoveStep],
  )
  const edges = useMemo(() => toFlowEdges(graph.nodes, graph.edges), [graph])

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: StepFlowNode): void => {
      onSelect(selectionOf(node.id))
    },
    [onSelect],
  )

  const handlePaneClick = useCallback((): void => {
    onSelect(NO_SELECTION)
  }, [onSelect])

  return (
    <div
      role="application"
      aria-label="Workflow canvas"
      className="relative size-full min-w-0"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        colorMode="dark"
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        selectNodesOnDrag={false}
        fitViewOptions={FIT_VIEW_OPTIONS}
        proOptions={PRO_OPTIONS}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
