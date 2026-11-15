import { z } from 'zod'

import {
  OutputSettingsSchema,
  defaultOutputSettings,
} from '@/features/workflows/output-settings'
import type { OutputSettings } from '@/features/workflows/output-settings'
import { AI_STEP_KIND, aiStepSchema } from '@/features/ai/ai-tools'
import type { AiContent } from '@/features/ai/ai-tools'
import { SHARP_OP_NAMES } from '@/lib/images/sharp/ops'

export enum WorkflowNodeKind {
  Input = 'input',
  Sharp = 'sharp',
  Output = 'output',
}

export const NodePositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
})

export type NodePosition = z.infer<typeof NodePositionSchema>

const BaseNodeSchema = z.object({
  id: z.uuid(),
  position: NodePositionSchema,
})

/** The Sources a workflow runs on: the User's own uploaded images, by id. */
const SourceIdsSchema = z.array(z.string().min(1)).default([])

export const SharpNodeSchema = BaseNodeSchema.extend({
  kind: z.literal(WorkflowNodeKind.Sharp),
  op: z
    .string()
    .refine((op) => SHARP_OP_NAMES.includes(op), 'Unknown Sharp op'),
  options: z.record(z.string(), z.json()),
})

export const AiNodeSchema = aiStepSchema({
  id: z.uuid(),
  position: NodePositionSchema,
})

export const WorkflowNodeSchema = z.discriminatedUnion('kind', [
  BaseNodeSchema.extend({
    kind: z.literal(WorkflowNodeKind.Input),
    sourceIds: SourceIdsSchema,
  }),
  BaseNodeSchema.extend({
    kind: z.literal(WorkflowNodeKind.Output),
    settings: OutputSettingsSchema.default(defaultOutputSettings),
  }),
  SharpNodeSchema,
  AiNodeSchema,
])

export const WorkflowEdgeSchema = z.object({
  id: z.uuid(),
  source: z.uuid(),
  target: z.uuid(),
})

export type WorkflowNode = z.output<typeof WorkflowNodeSchema>
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>
export type SharpNode = Extract<WorkflowNode, { kind: WorkflowNodeKind.Sharp }>
export type AiNode = Extract<WorkflowNode, { kind: typeof AI_STEP_KIND }>

interface Graph {
  nodes: ReadonlyArray<WorkflowNode>
  edges: ReadonlyArray<WorkflowEdge>
}

export function createEndpointNode(
  kind: WorkflowNodeKind.Input | WorkflowNodeKind.Output,
  position: NodePosition,
): WorkflowNode {
  const id = crypto.randomUUID()
  return kind === WorkflowNodeKind.Input
    ? { id, kind, position, sourceIds: [] }
    : { id, kind, position, settings: defaultOutputSettings() }
}

export function createSharpNode(op: string, position: NodePosition): SharpNode {
  return {
    id: crypto.randomUUID(),
    kind: WorkflowNodeKind.Sharp,
    op,
    options: {},
    position,
  }
}

export function createAiNode(
  content: AiContent<AiNode>,
  position: NodePosition,
): AiNode {
  return {
    id: crypto.randomUUID(),
    kind: AI_STEP_KIND,
    position,
    ...content,
  }
}

export function nodeOfKind(graph: Graph, kind: WorkflowNodeKind): WorkflowNode {
  const node = graph.nodes.find((candidate) => candidate.kind === kind)
  if (!node) throw new RangeError(`The workflow has no ${kind} step`)
  return node
}

function reaches(graph: Graph, from: string, to: string): boolean {
  let current: string | undefined = from
  const seen = new Set<string>()
  while (current !== undefined && !seen.has(current)) {
    if (current === to) return true
    seen.add(current)
    const step: string = current
    current = graph.edges.find((edge) => edge.source === step)?.target
  }
  return false
}

/**
 * Whether `source` may connect to `target`. Pipelines are a single line from
 * Input to Output, so each step has at most one connection in and one out,
 * and a connection may never close a loop.
 */
export function canConnect(
  graph: Graph,
  source: string,
  target: string,
): boolean {
  if (source === target) return false
  const from = graph.nodes.find(({ id }) => id === source)
  const to = graph.nodes.find(({ id }) => id === target)
  if (!from || !to) return false
  if (from.kind === WorkflowNodeKind.Output) return false
  if (to.kind === WorkflowNodeKind.Input) return false
  if (graph.edges.some((edge) => edge.source === source)) return false
  if (graph.edges.some((edge) => edge.target === target)) return false
  return !reaches(graph, target, source)
}

const STEP_GAP = 320

function createEdge(source: string, target: string): WorkflowEdge {
  return { id: crypto.randomUUID(), source, target }
}

/** The steps connected in a line from Input, in pipeline order. */
export function pipelineSteps(graph: Graph): Array<WorkflowNode> {
  const steps: Array<WorkflowNode> = []
  const seen = new Set<string>()
  let current: WorkflowNode | undefined = nodeOfKind(
    graph,
    WorkflowNodeKind.Input,
  )
  while (current && !seen.has(current.id)) {
    steps.push(current)
    seen.add(current.id)
    const from: string = current.id
    const next = graph.edges.find((edge) => edge.source === from)?.target
    current = graph.nodes.find(({ id }) => id === next)
  }
  return steps
}

function lastStepBeforeOutput(graph: Graph): WorkflowNode {
  const steps = pipelineSteps(graph)
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps.at(index)
    if (step && step.kind !== WorkflowNodeKind.Output) return step
  }
  return nodeOfKind(graph, WorkflowNodeKind.Input)
}

/** Pushes `first` and the steps after it right, just enough to clear `minX`. */
function clearRightOf(
  graph: Graph,
  first: string | undefined,
  minX: number,
): Map<string, number> {
  const moved = new Map<string, number>()
  let clearX = minX
  let current = graph.nodes.find(({ id }) => id === first)
  while (current && !moved.has(current.id)) {
    const x = Math.max(current.position.x, clearX)
    moved.set(current.id, x)
    clearX = x + STEP_GAP
    const from: string = current.id
    const next = graph.edges.find((edge) => edge.source === from)?.target
    current = graph.nodes.find(({ id }) => id === next)
  }
  return moved
}

/**
 * Inserts `step` straight after the step `afterId`, between it and the step
 * it led to. Choosing Output inserts just before Output. Later steps move
 * right when they would overlap.
 */
export function insertStepAfter<TGraph extends Graph>(
  graph: TGraph,
  afterId: string,
  step: WorkflowNode,
): TGraph {
  const chosen = graph.nodes.find(({ id }) => id === afterId)
  const after =
    !chosen || chosen.kind === WorkflowNodeKind.Output
      ? lastStepBeforeOutput(graph)
      : chosen
  const outgoing = graph.edges.find((edge) => edge.source === after.id)
  const placed = {
    ...step,
    position: { x: after.position.x + STEP_GAP, y: after.position.y },
  }
  const edges = graph.edges.filter((edge) => edge !== outgoing)
  edges.push(createEdge(after.id, placed.id))
  if (outgoing) edges.push(createEdge(placed.id, outgoing.target))
  const moved = clearRightOf(
    graph,
    outgoing?.target,
    placed.position.x + STEP_GAP,
  )
  const nodes = graph.nodes.map((node) => {
    const x = moved.get(node.id)
    return x === undefined
      ? node
      : { ...node, position: { ...node.position, x } }
  })
  return { ...graph, nodes: [...nodes, placed], edges }
}

/** Adds `step` to the end of the pipeline, just before Output. */
export function appendStep<TGraph extends Graph>(
  graph: TGraph,
  step: WorkflowNode,
): TGraph {
  const output = nodeOfKind(graph, WorkflowNodeKind.Output)
  const last = lastStepBeforeOutput(graph)
  const leadsToOutput = graph.edges.some(
    (edge) => edge.source === last.id && edge.target === output.id,
  )
  const outputFree = !graph.edges.some((edge) => edge.target === output.id)
  if (leadsToOutput || !outputFree) return insertStepAfter(graph, last.id, step)
  const joined = {
    ...graph,
    edges: [...graph.edges, createEdge(last.id, output.id)],
  }
  return insertStepAfter(joined, last.id, step)
}

/** Removes a step and joins the steps either side of it. Input and Output stay. */
export function removeStep<TGraph extends Graph>(
  graph: TGraph,
  id: string,
): TGraph {
  const step = graph.nodes.find((node) => node.id === id)
  if (
    !step ||
    step.kind === WorkflowNodeKind.Input ||
    step.kind === WorkflowNodeKind.Output
  ) {
    return graph
  }
  const before = graph.edges.find((edge) => edge.target === id)?.source
  const after = graph.edges.find((edge) => edge.source === id)?.target
  const remaining = {
    nodes: graph.nodes.filter((node) => node.id !== id),
    edges: graph.edges.filter(
      (edge) => edge.source !== id && edge.target !== id,
    ),
  }
  const edges = [...remaining.edges]
  if (before && after && canConnect(remaining, before, after)) {
    edges.push(createEdge(before, after))
  }
  return { ...graph, nodes: remaining.nodes, edges }
}

function mapInput<TGraph extends Graph>(
  graph: TGraph,
  update: (sourceIds: ReadonlyArray<string>) => Array<string>,
): TGraph {
  const nodes = graph.nodes.map((node) =>
    node.kind === WorkflowNodeKind.Input
      ? { ...node, sourceIds: update(node.sourceIds) }
      : node,
  )
  return { ...graph, nodes }
}

/** Adds Sources to Input in the order given, skipping ones it already has. */
export function addInputSources<TGraph extends Graph>(
  graph: TGraph,
  sourceIds: ReadonlyArray<string>,
): TGraph {
  return mapInput(graph, (current) => {
    const known = new Set(current)
    const added: Array<string> = []
    for (const id of sourceIds) {
      if (known.has(id)) continue
      known.add(id)
      added.push(id)
    }
    return [...current, ...added]
  })
}

export function removeInputSource<TGraph extends Graph>(
  graph: TGraph,
  sourceId: string,
): TGraph {
  return mapInput(graph, (current) => current.filter((id) => id !== sourceId))
}

/** Replaces how Output writes its results; every other step stays as it was. */
export function updateOutputSettings<TGraph extends Graph>(
  graph: TGraph,
  settings: OutputSettings,
): TGraph {
  const nodes = graph.nodes.map((node) =>
    node.kind === WorkflowNodeKind.Output ? { ...node, settings } : node,
  )
  return { ...graph, nodes }
}
