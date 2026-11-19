import { overlayToolFor } from '@/features/overlay/overlay-tools'
import { findStep } from '@/features/pipeline/pipeline'
import type { Pipeline } from '@/features/pipeline/pipeline'

/** The two pictures of a step that a tool draws on, like a layer and its mask in an image editor. */
export enum StepViewPart {
  /** The picture the step acts on, with the tool drawn on it. */
  Edit = 'edit',
  /** The picture the step leaves. */
  Result = 'result',
}

/** What the canvas shows for a step: one of its two pictures. */
export interface StepView {
  stepId: string
  part: StepViewPart
}

export function sameStepView(
  a: StepView | undefined,
  b: StepView | undefined,
): boolean {
  return a?.stepId === b?.stepId && a?.part === b?.part
}

/**
 * What the canvas should show instead of the whole document: the picture of
 * the selected step, when a tool draws on the picture for it, in the part
 * chosen. Undefined for any other step, so the document is shown.
 */
export function stepViewOf(
  selectedId: string | undefined,
  pipeline: Pipeline,
  part: StepViewPart,
): StepView | undefined {
  if (selectedId === undefined) return undefined
  const found = findStep(pipeline, selectedId)
  if (!found || overlayToolFor(found.step) === undefined) return undefined
  return { stepId: selectedId, part }
}
