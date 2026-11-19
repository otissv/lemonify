import { overlayToolFor } from '@/features/overlay/overlay-tools'
import { findStep } from '@/features/pipeline/pipeline'
import type { Pipeline } from '@/features/pipeline/pipeline'

/**
 * The step whose picture the canvas should show instead of the whole
 * document: the selected step, when a tool draws on the picture for it. The
 * picture is then the one the step acts on, so what the tool draws lines up
 * with the numbers of the step.
 */
export function viewedStepId(
  selectedId: string | undefined,
  pipeline: Pipeline,
): string | undefined {
  if (selectedId === undefined) return undefined
  const found = findStep(pipeline, selectedId)
  if (!found) return undefined
  return overlayToolFor(found.step) === undefined ? undefined : selectedId
}
