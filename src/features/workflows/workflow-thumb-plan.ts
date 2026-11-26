import { AI_STEP_KIND } from '@/features/ai/ai-tools'
import type { Canvas } from '@/features/pipeline/canvas'
import {
  PipelineStepKind,
  isGroupMember,
  planSteps,
} from '@/features/pipeline/pipeline'
import type {
  Pipeline,
  PipelineStep,
  PlanStep,
} from '@/features/pipeline/pipeline'
import { stepsThrough } from '@/features/pipeline/step-input'
import {
  CANVAS_NODE_ID,
  INPUTS_NODE_ID,
  OUTPUT_NODE_ID,
} from '@/features/workflows/workflow-graph-layout'

/** Steps that a workflow thumbnail may apply, with every AI step left out, at any depth of embedded document layers. */
export function omitAiSteps(
  steps: ReadonlyArray<PlanStep>,
): ReadonlyArray<PlanStep> {
  const kept: PlanStep[] = []
  for (const step of steps) {
    if (step.kind === AI_STEP_KIND) continue
    if (step.kind !== PipelineStepKind.EmbeddedDocument) {
      kept.push(step)
      continue
    }
    kept.push({ ...step, steps: withoutAi(step.steps) })
  }
  return kept
}

function withoutAi(steps: ReadonlyArray<PipelineStep>): PipelineStep[] {
  return steps.flatMap((step): PipelineStep[] => {
    if (step.kind === AI_STEP_KIND) return []
    if (step.kind === PipelineStepKind.Group) {
      return [{ ...step, steps: withoutAi(step.steps).filter(isGroupMember) }]
    }
    if (step.kind === PipelineStepKind.EmbeddedDocument) {
      return [{ ...step, steps: withoutAi(step.steps) }]
    }
    return [step]
  })
}

export type WorkflowThumbShown = {
  canvas: Canvas
  steps: ReadonlyArray<PlanStep>
}

function through(
  pipeline: Pipeline,
  stepId: string,
): ReadonlyArray<PlanStep> | undefined {
  const shown = stepsThrough(pipeline, stepId)
  return shown === undefined ? undefined : omitAiSteps(shown)
}

/**
 * Which steps to render for a workflow diagram node. AI steps are never run
 * for thumbnails: the picture stops before them, and the same picture is kept
 * for every node after until a Sharp step changes it. A step inside an
 * embedded document layer shows that layer's own picture; a group, which is
 * not a step of the picture, shows none.
 */
export function shownForWorkflowNode(
  filledPipeline: Pipeline,
  nodeId: string,
  /** The input slot, from the workflow before an image is placed in it. */
  slotId: string | undefined,
): WorkflowThumbShown | undefined {
  const { canvas } = filledPipeline
  if (nodeId === CANVAS_NODE_ID) return { canvas, steps: [] }
  if (nodeId === OUTPUT_NODE_ID) {
    return { canvas, steps: omitAiSteps(planSteps(filledPipeline)) }
  }
  if (nodeId === INPUTS_NODE_ID) {
    if (slotId === undefined) return { canvas, steps: [] }
    const shown = through(filledPipeline, slotId)
    return shown === undefined ? undefined : { canvas, steps: shown }
  }
  const shown = through(filledPipeline, nodeId)
  return shown === undefined ? undefined : { canvas, steps: shown }
}
