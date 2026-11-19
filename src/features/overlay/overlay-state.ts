import type { PipelinePreview } from '@/features/pipeline/use-preview'
import { stepsBefore } from '@/features/pipeline/step-input'

/**
 * Whether an AI step ahead of the step has not run. Until it has, the picture
 * the step acts on is not known, so nothing can be drawn on it.
 */
export function waitsForEarlierAi(
  preview: Pick<PipelinePreview, 'pipeline' | 'pending'>,
  stepId: string,
): boolean {
  const ahead = stepsBefore(preview.pipeline, stepId) ?? []
  return ahead.some(({ id }) => preview.pending.includes(id))
}
