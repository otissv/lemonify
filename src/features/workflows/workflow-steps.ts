import { AiToolId } from '@/features/ai/ai-tools'
import { EXPORT_FORMAT_LABELS } from '@/features/export/export-settings'
import { isLayerStep, layerKind } from '@/features/pipeline/layer-kinds'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { AiStep, PipelineStep } from '@/features/pipeline/pipeline'
import type { LayerNames } from '@/features/pipeline/layer-kinds'
import { pipelineStepTitle } from '@/features/pipeline/step-problems'
import type { OutputSettings } from '@/features/workflows/output-settings'
import { missingSharpOptions } from '@/features/workflows/sharp-op-fields'

export const INPUT_SLOT_SUMMARY = 'Each input image goes here'
export const NO_IMAGES_SUMMARY = 'No images yet'
export const NO_IMAGE_SUMMARY = 'No image yet'

/** The name a step is shown by in the list and in the options. */
export function stepLabel(step: PipelineStep): string {
  return pipelineStepTitle(step)
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`
}

function aiSummary(step: AiStep): string {
  switch (step.tool) {
    case AiToolId.Upscale:
      return `${step.settings.model} · ${step.settings.scale}×`
  }
}

/**
 * A short line under the step's name saying how it is set up. `names` finds
 * the names of what a layer uses (its image, document or workflow), which only
 * the page knows; `slotId` is the workflow's input slot, where each input
 * image goes.
 */
export function stepSummary(
  step: PipelineStep,
  names: LayerNames,
  slotId?: string,
): string {
  if (isLayerStep(step)) {
    if (step.id === slotId) return INPUT_SLOT_SUMMARY
    return layerKind(step).display(step, names).text
  }
  switch (step.kind) {
    case PipelineStepKind.Group:
      return plural(step.steps.length, 'step', 'steps')
    case PipelineStepKind.EmbeddedDocument:
      return `${plural(step.steps.length, 'step', 'steps')} · embedded document`
    case PipelineStepKind.Ai:
      return aiSummary(step)
    case PipelineStepKind.Sharp: {
      const missing = missingSharpOptions(step.op, step.options).length
      if (missing > 0) return `Needs ${plural(missing, 'option', 'options')}`
      const count = Object.keys(step.options).length
      if (count === 0) return 'Default options'
      return plural(count, 'option set', 'options set')
    }
  }
}

export function inputsSummary(count: number): string {
  if (count === 0) return NO_IMAGES_SUMMARY
  return plural(count, 'image', 'images')
}

export function outputSummary({ format, widths }: OutputSettings): string {
  const label = EXPORT_FORMAT_LABELS[format]
  if (widths.length === 0) return label
  return `${label} · ${plural(widths.length, 'size', 'sizes')}`
}
