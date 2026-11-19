import { overlayToolFor } from '@/features/overlay/overlay-tools'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { Pipeline } from '@/features/pipeline/pipeline'

/** The ids of the steps a tool draws on the picture for, in groups too. */
export function toolStepIds(pipeline: Pipeline): string[] {
  const ids: string[] = []
  for (const step of pipeline.steps) {
    if (step.kind !== PipelineStepKind.Group) {
      if (overlayToolFor(step) !== undefined) ids.push(step.id)
      continue
    }
    for (const inner of step.steps) {
      if (overlayToolFor(inner) !== undefined) ids.push(inner.id)
    }
  }
  return ids
}
