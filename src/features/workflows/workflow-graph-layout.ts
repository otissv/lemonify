import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import type { Workflow } from '@/features/workflows/workflow'

export const COLUMN_WIDTH = 260
export const ROW_HEIGHT = 200

export const CANVAS_NODE_ID = 'canvas'
export const INPUTS_NODE_ID = 'inputs'
export const OUTPUT_NODE_ID = 'output'

export type GraphNode = {
  id: string
  kind: 'canvas' | 'inputs' | 'step' | 'output'
  x: number
  y: number
  /** For a step inside a group: the group it is drawn under. */
  groupId?: string
}

export type GraphEdge = {
  id: string
  source: string
  target: string
  /** Whether the line leaves or joins the main line through a group's branch. */
  branch: boolean
}

export type WorkflowGraph = { nodes: GraphNode[]; edges: GraphEdge[] }

function edge(source: string, target: string, branch: boolean): GraphEdge {
  return { id: `${source}->${target}`, source, target, branch }
}

/**
 * The workflow as a diagram, laid out from the pipeline itself, so there is
 * nothing to store or arrange: the canvas, the input images, the steps in order
 * and the output make the main line. The steps of a group hang under it as a
 * branch that joins the line again after the group, and the branch gets the
 * columns it needs so two branches never overlap.
 */
export function workflowGraph(workflow: Workflow): WorkflowGraph {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const line: Array<{ id: string; tail: string }> = []
  let column = 0

  function place(node: Omit<GraphNode, 'x' | 'y'>, at: number): void {
    nodes.push({ ...node, x: at * COLUMN_WIDTH, y: 0 })
  }

  place({ id: CANVAS_NODE_ID, kind: 'canvas' }, column)
  line.push({ id: CANVAS_NODE_ID, tail: CANVAS_NODE_ID })
  column += 1
  place({ id: INPUTS_NODE_ID, kind: 'inputs' }, column)
  line.push({ id: INPUTS_NODE_ID, tail: INPUTS_NODE_ID })
  column += 1

  for (const step of workflow.pipeline.steps) {
    place({ id: step.id, kind: 'step' }, column)
    const members: PipelineStep[] =
      step.kind === PipelineStepKind.Group ? step.steps : []
    for (const [index, member] of members.entries()) {
      nodes.push({
        id: member.id,
        kind: 'step',
        groupId: step.id,
        x: (column + index) * COLUMN_WIDTH,
        y: ROW_HEIGHT,
      })
    }
    line.push({ id: step.id, tail: members.at(-1)?.id ?? step.id })
    column += Math.max(1, members.length)
  }

  place({ id: OUTPUT_NODE_ID, kind: 'output' }, column)
  line.push({ id: OUTPUT_NODE_ID, tail: OUTPUT_NODE_ID })

  for (const [index, current] of line.entries()) {
    const next = line[index + 1]
    if (next === undefined) continue
    edges.push(edge(current.tail, next.id, current.tail !== current.id))
  }
  for (const step of workflow.pipeline.steps) {
    if (step.kind !== PipelineStepKind.Group) continue
    let previous = step.id
    for (const member of step.steps) {
      edges.push(edge(previous, member.id, true))
      previous = member.id
    }
  }
  return { nodes, edges }
}

/** Every node on the workflow diagram, in layout order. */
export function workflowPreviewNodeIds(workflow: Workflow): string[] {
  return workflowGraph(workflow).nodes.map((node) => node.id)
}
