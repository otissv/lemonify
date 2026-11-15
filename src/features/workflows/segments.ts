import { AI_STEP_KIND } from '@/features/ai/ai-tools'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { SharpStep } from '@/features/pipeline/pipeline'
import {
  WorkflowNodeKind,
  pipelineSteps,
} from '@/features/workflows/workflow-graph'
import type {
  AiNode,
  SharpNode,
  WorkflowEdge,
  WorkflowNode,
} from '@/features/workflows/workflow-graph'

/** Consecutive Sharp steps, run as one pass over the image. */
export type SharpSegment = { kind: 'sharp'; nodes: ReadonlyArray<SharpNode> }
/** One AI step, which runs on the GPU and can be batched with other images. */
export type AiSegment = { kind: 'ai'; node: AiNode }
export type Segment = SharpSegment | AiSegment

type Graph = {
  nodes: ReadonlyArray<WorkflowNode>
  edges: ReadonlyArray<WorkflowEdge>
}

const NOT_CONNECTED = 'Connect every step from Input to Output.'
const NO_INPUT = 'Add at least one image to Input.'

/** Why a workflow cannot run yet, in plain words, or undefined when it can. */
export function workflowProblem(graph: Graph): string | undefined {
  const steps = pipelineSteps(graph)
  if (steps.at(-1)?.kind !== WorkflowNodeKind.Output) return NOT_CONNECTED
  const input = steps[0]
  if (input?.kind !== WorkflowNodeKind.Input || input.sourceIds.length === 0) {
    return NO_INPUT
  }
  return undefined
}

/**
 * Splits a workflow's line of steps into the pieces a run executes: Sharp
 * steps between AI steps are one segment each, and every AI step is its own.
 * The last segment is always a Sharp one (possibly empty) because the Output
 * settings are applied in it.
 */
export function planSegments(graph: Graph): Segment[] {
  const segments: Segment[] = []
  let sharp: SharpNode[] = []
  for (const step of pipelineSteps(graph)) {
    if (step.kind === WorkflowNodeKind.Sharp) {
      sharp.push(step)
      continue
    }
    if (step.kind !== AI_STEP_KIND) continue
    if (sharp.length > 0) segments.push({ kind: 'sharp', nodes: sharp })
    sharp = []
    segments.push({ kind: 'ai', node: step })
  }
  if (sharp.length > 0 || segments.at(-1)?.kind !== 'sharp') {
    segments.push({ kind: 'sharp', nodes: sharp })
  }
  return segments
}

/** A workflow's Sharp node as a Pipeline step (a workflow step is never switched off), so the same planning and checks apply. */
export function toSharpStep(node: SharpNode): SharpStep {
  return {
    id: node.id,
    kind: PipelineStepKind.Sharp,
    op: node.op,
    options: node.options,
    enabled: true,
  }
}
