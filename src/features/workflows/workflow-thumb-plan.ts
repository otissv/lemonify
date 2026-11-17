import { AI_STEP_KIND } from '@/features/ai/ai-tools'
import type { Canvas } from '@/features/pipeline/canvas'
import {
  PipelineStepKind,
  planSteps,
} from '@/features/pipeline/pipeline'
import type { LeafStep, Pipeline, PlanStep } from '@/features/pipeline/pipeline'
import {
  CANVAS_NODE_ID,
  INPUTS_NODE_ID,
  OUTPUT_NODE_ID,
} from '@/features/workflows/workflow-graph-layout'

/** Steps that a workflow thumbnail may apply, with every AI step left out. */
export function omitAiSteps(
  steps: ReadonlyArray<PlanStep>,
): ReadonlyArray<PlanStep> {
  const kept: PlanStep[] = []
  for (const step of steps) {
    if (step.kind === AI_STEP_KIND) continue
    if (step.kind !== PipelineStepKind.Group) {
      kept.push(step)
      continue
    }
    const inner = omitAiSteps(step.steps)
    if (inner.length === 0 && !step.subDocument) continue
    kept.push({ ...step, steps: [...inner] } as PlanStep)
  }
  return kept
}

function stepsThrough(
  steps: ReadonlyArray<PlanStep>,
  throughStepId: string,
): ReadonlyArray<PlanStep> | undefined {
  const index = steps.findIndex((step) => step.id === throughStepId)
  if (index < 0) return undefined
  return omitAiSteps(steps.slice(0, index + 1))
}

function stepsThroughGroupMember(
  steps: ReadonlyArray<PlanStep>,
  throughStepId: string,
): ReadonlyArray<LeafStep> | undefined {
  for (const step of steps) {
    if (step.kind !== PipelineStepKind.Group) continue
    const index = step.steps.findIndex((member) => member.id === throughStepId)
    if (index < 0) continue
    return omitAiSteps(step.steps.slice(0, index + 1)) as ReadonlyArray<LeafStep>
  }
  return undefined
}

export type WorkflowThumbShown = {
  canvas: Canvas
  steps: ReadonlyArray<PlanStep>
}

/**
 * Which steps to render for a workflow diagram node. AI steps are never run
 * for thumbnails: the picture stops before them, and the same picture is kept
 * for every node after until a Sharp step changes it.
 */
export function shownForWorkflowNode(
  filledPipeline: Pipeline,
  nodeId: string,
  /** The first input slot, from the workflow before an image is placed in it. */
  firstSlotId: string | undefined,
): WorkflowThumbShown | undefined {
  const { canvas } = filledPipeline
  const steps = planSteps(filledPipeline)

  if (nodeId === CANVAS_NODE_ID) {
    return { canvas, steps: [] }
  }

  const inGroup = stepsThroughGroupMember(steps, nodeId)
  if (inGroup !== undefined) {
    return { canvas, steps: inGroup }
  }

  if (nodeId === INPUTS_NODE_ID) {
    if (firstSlotId === undefined) return { canvas, steps: [] }
    const shown = stepsThrough(steps, firstSlotId)
    return shown === undefined ? undefined : { canvas, steps: shown }
  }

  if (nodeId === OUTPUT_NODE_ID) {
    return { canvas, steps: omitAiSteps(steps) }
  }

  const shown = stepsThrough(steps, nodeId)
  return shown === undefined ? undefined : { canvas, steps: shown }
}