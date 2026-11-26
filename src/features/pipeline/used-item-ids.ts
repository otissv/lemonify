import { isLayerStep, layerKind } from '@/features/pipeline/layer-kinds'
import { PipelineStepKind, isGroupMember } from '@/features/pipeline/pipeline'
import type { Pipeline, PipelineStep } from '@/features/pipeline/pipeline'

function remapSteps(
  steps: ReadonlyArray<PipelineStep>,
  ids: ReadonlyMap<string, string>,
): PipelineStep[] {
  return steps.map((step): PipelineStep => {
    if (step.kind === PipelineStepKind.Group) {
      return {
        ...step,
        steps: remapSteps(step.steps, ids).filter(isGroupMember),
      }
    }
    if (step.kind === PipelineStepKind.EmbeddedDocument) {
      return { ...step, steps: remapSteps(step.steps, ids) }
    }
    if (!isLayerStep(step)) return step
    const kind = layerKind(step)
    return kind.uses(step) === undefined ? step : kind.withUsedIds(step, ids)
  })
}

/** The pipeline with each document and workflow its layers use, at any depth, named by its entry in `ids`. Throws a RangeError for one with no entry. */
export function remapUsedItems(
  pipeline: Pipeline,
  ids: ReadonlyMap<string, string>,
): Pipeline {
  return { ...pipeline, steps: remapSteps(pipeline.steps, ids) }
}
