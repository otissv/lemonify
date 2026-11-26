import {
  PipelineStepKind,
  planSteps,
  stepAncestors,
} from '@/features/pipeline/pipeline'
import type { PlanStep, Pipeline } from '@/features/pipeline/pipeline'

/**
 * The steps of the picture a step is drawn in, as the planner sees them: the
 * innermost embedded document layer around it that is on (each one around
 * that is on too), or else the pipeline. A container that is off is opened,
 * with everything in it off, into the picture around it.
 */
function pictureSteps(
  pipeline: Pick<Pipeline, 'steps'>,
  stepId: string,
): ReadonlyArray<PlanStep> | undefined {
  const around = stepAncestors(pipeline, stepId)
  if (around === undefined) return undefined
  let picture: Pick<Pipeline, 'steps'> = pipeline
  for (const container of around) {
    if (!container.enabled) break
    if (container.kind === PipelineStepKind.EmbeddedDocument) {
      picture = container
    }
  }
  return planSteps(picture)
}

function stepsAround(
  pipeline: Pick<Pipeline, 'steps'>,
  stepId: string,
  inclusive: boolean,
): ReadonlyArray<PlanStep> | undefined {
  const steps = pictureSteps(pipeline, stepId)
  if (steps === undefined) return undefined
  const index = steps.findIndex((step) => step.id === stepId)
  if (index < 0) return undefined
  return steps.slice(0, index + (inclusive ? 1 : 0))
}

/**
 * The steps that make the picture a step acts on, in order: the steps ahead
 * of it in the picture it is drawn in, which for a step inside an embedded
 * document layer is that layer's own picture. Undefined when no step has this
 * id, or for a group, which is not a step of the picture. An embedded document
 * layer is itself a step of the picture around it.
 */
export function stepsBefore(
  pipeline: Pick<Pipeline, 'steps'>,
  stepId: string,
): ReadonlyArray<PlanStep> | undefined {
  return stepsAround(pipeline, stepId, false)
}

/** The steps that make the picture a step leaves: those ahead of it and the step itself, within the picture it is drawn in. Undefined when no step has this id. */
export function stepsThrough(
  pipeline: Pick<Pipeline, 'steps'>,
  stepId: string,
): ReadonlyArray<PlanStep> | undefined {
  return stepsAround(pipeline, stepId, true)
}
