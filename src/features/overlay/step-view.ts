import {
  ToolPictureSource,
  overlayToolFor,
} from '@/features/overlay/overlay-tools'
import { findStep } from '@/features/pipeline/pipeline'
import type { Pipeline } from '@/features/pipeline/pipeline'

/**
 * The two pictures of a step that has a tool: the tool's own picture, which
 * the tool says how to make (see `ToolPictureSource`), and the Output, which
 * is always the picture through the step.
 */
export enum StepViewPart {
  Tool = 'tool',
  Output = 'output',
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

/** What to ask the server for to make a step view's picture: the picture through the step for the Output, and for the tool's own picture whatever the tool says. */
export interface PreviewPictureRequest {
  beforeStepId?: string
  throughStepId?: string
}

export function previewPictureRequest(
  pipeline: Pipeline,
  view: StepView,
): PreviewPictureRequest {
  if (view.part === StepViewPart.Output) return { throughStepId: view.stepId }
  const step = findStep(pipeline, view.stepId)?.step
  const tool = step === undefined ? undefined : overlayToolFor(step)
  switch (tool?.picture) {
    case ToolPictureSource.BeforeStep:
      return { beforeStepId: view.stepId }
    case undefined:
      return {}
  }
}
