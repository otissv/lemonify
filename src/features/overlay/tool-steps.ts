import {
  ToolPictureSource,
  overlayToolFor,
} from '@/features/overlay/overlay-tools'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { Pipeline, PipelineStep } from '@/features/pipeline/pipeline'

/** The ids of the steps whose tool picture is the picture before the step, in groups too: those the thumbnail job makes a before picture for. */
function isBefore(step: PipelineStep): boolean {
  return overlayToolFor(step)?.picture === ToolPictureSource.BeforeStep
}

export function toolStepIds(pipeline: Pipeline): string[] {
  const ids: string[] = []
  for (const step of pipeline.steps) {
    if (step.kind !== PipelineStepKind.Group) {
      if (isBefore(step)) ids.push(step.id)
      continue
    }
    for (const inner of step.steps) {
      if (isBefore(inner)) ids.push(inner.id)
    }
  }
  return ids
}
