import {
  ToolPictureSource,
  overlayToolFor,
} from '@/features/overlay/overlay-tools'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { Pipeline, PipelineStep } from '@/features/pipeline/pipeline'
import { startsAtPictureSize } from '@/features/pipeline/sharp-starting-options'

/** A step needs the picture before it when a tool draws on that picture, or when it starts at that picture's size, which the before picture says. */
function needsBefore(step: PipelineStep): boolean {
  if (overlayToolFor(step)?.picture === ToolPictureSource.BeforeStep) {
    return true
  }
  return step.kind === PipelineStepKind.Sharp && startsAtPictureSize(step.op)
}

/** The ids of the steps, in groups too, that the thumbnail job makes a before picture for. */
export function toolStepIds(pipeline: Pipeline): string[] {
  const ids: string[] = []
  for (const step of pipeline.steps) {
    if (step.kind !== PipelineStepKind.Group) {
      if (needsBefore(step)) ids.push(step.id)
      continue
    }
    for (const inner of step.steps) {
      if (needsBefore(inner)) ids.push(inner.id)
    }
  }
  return ids
}
