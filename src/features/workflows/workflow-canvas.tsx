import '@xyflow/react/dist/style.css'

import { Background, Controls, ReactFlow } from '@xyflow/react'
import type { Edge } from '@xyflow/react'
import { useCallback, useMemo } from 'react'

import { useLayerNames } from '@/features/documents/item-names'
import { workflowThumbnailImageUrl } from '@/features/documents/image-urls'
import type { LayerNames } from '@/features/pipeline/layer-kinds'
import { usePipelineStore } from '@/store/pipeline-store'

import { findStep, isContainerStep } from '@/features/pipeline/pipeline'
import { FrameNode } from '@/features/workflows/frame-node'
import type { FrameFlowNode } from '@/features/workflows/frame-node'
import { inputSlot } from '@/features/workflows/segments'
import { StepNode } from '@/features/workflows/step-node'
import type { StepFlowNode } from '@/features/workflows/step-node'
import { CanvasSize } from '@/features/workflows/workflow'
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

const NODE_TYPES = { step: StepNode, frame: FrameNode }
/** What the Canvas node says when each image is drawn on a canvas of its own size. */
const MATCH_INPUT_SUMMARY = 'Size of each image'
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
  names: LayerNames,
  slotId: string | undefined,
): { label: string; summary: string; enabled: boolean } {
  switch (node.kind) {
    case 'canvas': {
      const { width, height, background } = workflow.pipeline.canvas
      const size =
        workflow.canvasSize === CanvasSize.Fixed
          ? `${width} × ${height} px`
          : MATCH_INPUT_SUMMARY
      return {
        label: 'Canvas',
        summary: `${size} · ${background}`,
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
    case 'step':
    case 'frame': {
      const step = findStep(workflow.pipeline, node.id)?.step
      if (step === undefined) return { label: '', summary: '', enabled: false }
      return {
        label: stepLabel(step),
        summary: stepSummary(step, names, slotId),
        enabled: step.enabled,
      }
    }
  }
}

function thumbnailOf(
  workflowId: string,
  nodeId: string,
  thumbnails: ReadonlyArray<{ stepId: string; key: string | null }> | undefined,
): string | undefined {
  const key = thumbnails?.find(({ stepId }) => stepId === nodeId)?.key
  return key === null || key === undefined
    ? undefined
    : workflowThumbnailImageUrl(workflowId, key)
}

type DiagramNode = StepFlowNode | FrameFlowNode

function toFlowNodes(
  workflow: Workflow,
  nodes: ReadonlyArray<GraphNode>,
  selection: Selection,
  names: LayerNames,
  thumbnails: ReadonlyArray<{ stepId: string; key: string | null }> | undefined,
  onRemoveStep: (stepId: string) => void,
): DiagramNode[] {
  const chosen = selectedStepId(selection)
  const slotId = inputSlot(workflow.pipeline)?.id
  return nodes.map((node): DiagramNode => {
    const placed = {
      id: node.id,
      position: { x: node.x, y: node.y },
      ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
      draggable: false,
      connectable: false,
      deletable: false,
      selected: selectionIsNode(selection, node, chosen),
    }
    const described = describe(workflow, node, names, slotId)
    if (node.kind === 'frame') {
      const container = findStep(workflow.pipeline, node.id)?.step
      return {
        ...placed,
        type: 'frame',
        style: { width: node.width, height: node.height },
        data: {
          ...described,
          onLine:
            container !== undefined && isContainerStep(container)
              ? container.steps.length === 0
              : false,
          onDelete: onRemoveStep,
        },
      }
    }
    return {
      ...placed,
      type: 'step',
      data: {
        ...described,
        thumbnail: thumbnailOf(workflow.id, node.id, thumbnails),
        position:
          node.kind === 'canvas'
            ? 'start'
            : node.kind === 'output'
              ? 'end'
              : 'middle',
        deletable: node.kind === 'step',
        onDelete: node.kind === 'step' ? onRemoveStep : undefined,
      },
    }
  })
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

function toFlowEdges(edges: ReadonlyArray<GraphEdge>): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: 'out',
    targetHandle: 'in',
  }))
}

/** The workflow as a diagram: the line of steps from the canvas to the output, with each group and embedded document layer a frame around its steps, at any depth. Select a node or a frame to see its options in the panel; steps are added and changed there. */
export function WorkflowCanvas({
  workflow,
  selection,
  onSelect,
  onRemoveStep,
  imageName,
}: WorkflowCanvasProps): React.JSX.Element {
  const thumbnails = usePipelineStore((state) => state.thumbnails[workflow.id])
  const items = useLayerNames(undefined)
  const names = useMemo<LayerNames>(
    () => ({ ...items, image: imageName }),
    [items, imageName],
  )
  const graph = useMemo(() => workflowGraph(workflow), [workflow])
  const nodes = useMemo(
    () =>
      toFlowNodes(
        workflow,
        graph.nodes,
        selection,
        names,
        thumbnails,
        onRemoveStep,
      ),
    [workflow, graph.nodes, selection, names, thumbnails, onRemoveStep],
  )
  const edges = useMemo(() => toFlowEdges(graph.edges), [graph])

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: DiagramNode): void => {
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
