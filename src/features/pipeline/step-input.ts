import { PipelineStepKind, planSteps } from '@/features/pipeline/pipeline'
import type { PlanStep, Pipeline } from '@/features/pipeline/pipeline'

/**
 * The steps that make the picture a step acts on, in order: the steps ahead
 * of it, or for a step inside a sub-document the steps ahead of it in that
 * sub-document, which has a picture of its own. Undefined when no step has
 * this id. A group that is a sub-document is itself a step on the canvas.
 */
export function stepsBefore(
  pipeline: Pick<Pipeline, 'steps'>,
  stepId: string,
): ReadonlyArray<PlanStep> | undefined {
  const steps = planSteps(pipeline)
  const index = steps.findIndex((step) => step.id === stepId)
  if (index >= 0) return steps.slice(0, index)
  for (const step of steps) {
    if (step.kind !== PipelineStepKind.Group) continue
    const inner = step.steps.findIndex((candidate) => candidate.id === stepId)
    if (inner >= 0) return step.steps.slice(0, inner)
  }
  return undefined
}
