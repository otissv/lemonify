import { isContainerStep } from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import type { Workflow } from '@/features/workflows/workflow'

/** How wide and tall a node is drawn (see `step-node.tsx`). */
export const NODE_WIDTH = 208
export const NODE_HEIGHT = 176
/** The space between two things on one line. */
export const NODE_GAP = 52
export const COLUMN_WIDTH = NODE_WIDTH + NODE_GAP
/** The space inside a frame around its steps, and the room its name takes at the top. */
export const FRAME_PADDING = 24
export const FRAME_HEADER = 64

export const CANVAS_NODE_ID = 'canvas'
export const INPUTS_NODE_ID = 'inputs'
export const OUTPUT_NODE_ID = 'output'

/**
 * One thing on the diagram. A frame is a group or an embedded document layer,
 * drawn around its steps. A node inside a frame names it as `parentId`, and
 * its `x` and `y` are measured from the frame's top left corner.
 */
export type GraphNode = {
  id: string
  kind: 'canvas' | 'inputs' | 'step' | 'frame' | 'output'
  x: number
  y: number
  width: number
  height: number
  parentId?: string
}

export type GraphEdge = { id: string; source: string; target: string }

export type WorkflowGraph = { nodes: GraphNode[]; edges: GraphEdge[] }

type Size = { width: number; height: number }

const NODE_SIZE: Size = { width: NODE_WIDTH, height: NODE_HEIGHT }

/**
 * Lays out one list of steps in a row from `x`, at `y`, inside `parentId`
 * (or on the diagram), and returns the size it takes. A container is a frame
 * with its own list laid out inside it, so frames nest.
 */
function layoutList(
  steps: ReadonlyArray<PipelineStep>,
  at: { x: number; y: number; parentId: string | undefined },
  nodes: GraphNode[],
): Size {
  let x = at.x
  let height = 0
  for (const step of steps) {
    const parent = at.parentId === undefined ? {} : { parentId: at.parentId }
    if (!isContainerStep(step)) {
      nodes.push({
        id: step.id,
        kind: 'step',
        x,
        y: at.y,
        ...NODE_SIZE,
        ...parent,
      })
      x += COLUMN_WIDTH
      height = Math.max(height, NODE_HEIGHT)
      continue
    }
    const frame: GraphNode = {
      id: step.id,
      kind: 'frame',
      x,
      y: at.y,
      ...NODE_SIZE,
      ...parent,
    }
    nodes.push(frame)
    const inner =
      step.steps.length === 0
        ? NODE_SIZE
        : layoutList(
            step.steps,
            { x: FRAME_PADDING, y: FRAME_HEADER, parentId: step.id },
            nodes,
          )
    frame.width = inner.width + 2 * FRAME_PADDING
    frame.height = FRAME_HEADER + inner.height + FRAME_PADDING
    x += frame.width + NODE_GAP
    height = Math.max(height, frame.height)
  }
  return { width: Math.max(0, x - at.x - NODE_GAP), height }
}

/** The ids the line runs through, in the order the picture is made: each step, with a container opened, or the container itself when it is empty. */
function lineIds(steps: ReadonlyArray<PipelineStep>): string[] {
  return steps.flatMap((step) => {
    if (!isContainerStep(step)) return [step.id]
    return step.steps.length === 0 ? [step.id] : lineIds(step.steps)
  })
}

/**
 * The workflow as a diagram, laid out from the pipeline itself, so there is
 * nothing to store or arrange: the canvas, the input images, the steps in order
 * and the output make one line. A group or an embedded document layer is a
 * frame around its steps, at any depth, and the line runs through the steps
 * inside it.
 */
export function workflowGraph(workflow: Workflow): WorkflowGraph {
  const nodes: GraphNode[] = [
    { id: CANVAS_NODE_ID, kind: 'canvas', x: 0, y: 0, ...NODE_SIZE },
    { id: INPUTS_NODE_ID, kind: 'inputs', x: COLUMN_WIDTH, y: 0, ...NODE_SIZE },
  ]
  const steps = workflow.pipeline.steps
  const start = COLUMN_WIDTH * 2
  const row = layoutList(steps, { x: start, y: 0, parentId: undefined }, nodes)
  const outputX = steps.length === 0 ? start : start + row.width + NODE_GAP
  nodes.push({
    id: OUTPUT_NODE_ID,
    kind: 'output',
    x: outputX,
    y: 0,
    ...NODE_SIZE,
  })
  const line = [
    CANVAS_NODE_ID,
    INPUTS_NODE_ID,
    ...lineIds(steps),
    OUTPUT_NODE_ID,
  ]
  const edges: GraphEdge[] = []
  for (const [index, source] of line.entries()) {
    const target = line[index + 1]
    if (target === undefined) continue
    edges.push({ id: `${source}->${target}`, source, target })
  }
  return { nodes, edges }
}

/** Every node on the workflow diagram, in layout order. */
export function workflowPreviewNodeIds(workflow: Workflow): string[] {
  return workflowGraph(workflow).nodes.map((node) => node.id)
}
