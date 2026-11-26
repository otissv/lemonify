import { describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { ExportFormat } from '@/features/export/export-settings'
import {
  createDocumentLayerStep,
  createImageLayerStep,
  createWorkflowLayerStep,
} from '@/features/pipeline/layer-kinds'
import type { LayerNames } from '@/features/pipeline/layer-kinds'
import {
  createAiStep,
  createEmbeddedDocumentStep,
  createGroupStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import { defaultOutputSettings } from '@/features/workflows/output-settings'
import {
  INPUT_SLOT_SUMMARY,
  inputsSummary,
  outputSummary,
  stepLabel,
  stepSummary,
} from '@/features/workflows/workflow-steps'

const NAME: LayerNames = {
  image: (id) => `${id}.png`,
  document: (id) => (id === 'd1' ? 'Badge' : undefined),
  workflow: (id) => (id === 'w1' ? 'Brand' : undefined),
}

describe('stepLabel', () => {
  it('is the name a step was given, or its tool’s name', () => {
    expect(stepLabel(createSharpStep('autoOrient'))).toBe('Auto orient')
    expect(stepLabel({ ...createSharpStep('blur'), name: 'Soft' })).toBe('Soft')
    expect(stepLabel(createImageLayerStep())).toBe('Image layer')
    expect(stepLabel(createGroupStep([]))).toBe('Group')
  })
})

describe('stepSummary', () => {
  it('says the input slot is where each input image goes, whatever image it has', () => {
    const slot = createImageLayerStep('placeholder')

    expect(stepSummary(slot, NAME, slot.id)).toBe(INPUT_SLOT_SUMMARY)
    expect(stepSummary(createImageLayerStep(), NAME, slot.id)).toBe(
      'No image yet',
    )
    expect(stepSummary(createImageLayerStep('logo'), NAME, slot.id)).toBe(
      'logo.png',
    )
  })

  it('names the document or workflow a layer draws, and a workflow layer’s image', () => {
    expect(stepSummary(createDocumentLayerStep('d1'), NAME)).toBe('Badge')
    expect(stepSummary(createWorkflowLayerStep('w1', 'logo'), NAME)).toBe(
      'Brand · logo.png',
    )
    expect(stepSummary(createDocumentLayerStep('gone'), NAME)).toBe(
      'Document not available',
    )
  })

  it('says how many options a Sharp step still needs, or has set', () => {
    expect(stepSummary(createSharpStep('extract'), NAME)).toMatch(/^Needs/)
    expect(stepSummary(createSharpStep('flip'), NAME)).toBe('Default options')
    expect(stepSummary(createSharpStep('blur', { sigma: 2 }), NAME)).toBe(
      '1 option set',
    )
  })

  it('names the model and scale of an upscale step', () => {
    const step = createAiStep({
      tool: AiToolId.Upscale,
      settings: { model: 'm', scale: 4, iterations: 1, tta: false },
    })

    expect(stepSummary(step, NAME)).toBe('m · 4×')
  })

  it('counts the steps in a group, and says which is an embedded document layer', () => {
    const steps = [createSharpStep('flip')]

    expect(stepSummary(createGroupStep(steps), NAME)).toBe('1 step')
    expect(stepSummary(createEmbeddedDocumentStep(steps), NAME)).toBe(
      '1 step · embedded document',
    )
  })
})

describe('inputsSummary and outputSummary', () => {
  it('count the images and the sizes', () => {
    expect(inputsSummary(0)).toBe('No images yet')
    expect(inputsSummary(1)).toBe('1 image')
    expect(inputsSummary(3)).toBe('3 images')
    const output = defaultOutputSettings()
    expect(outputSummary({ ...output, format: ExportFormat.Webp })).toBe('WebP')
    expect(outputSummary({ ...output, widths: [1, 2] })).toMatch(/2 sizes$/)
  })
})
