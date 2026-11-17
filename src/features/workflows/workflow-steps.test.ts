import { describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { ExportFormat } from '@/features/export/export-settings'
import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import {
  createAiStep,
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

const NAME = (id: string): string => `${id}.png`

describe('stepLabel', () => {
  it('is the name a step was given, or its tool’s name', () => {
    expect(stepLabel(createSharpStep('autoOrient'))).toBe('Auto orient')
    expect(stepLabel({ ...createSharpStep('blur'), name: 'Soft' })).toBe('Soft')
    expect(stepLabel(createImageLayerStep())).toBe('Image layer')
    expect(stepLabel(createGroupStep([]))).toBe('Group')
  })
})

describe('stepSummary', () => {
  it('says an image layer with no image is where each input image goes', () => {
    expect(stepSummary(createImageLayerStep(), NAME)).toBe(INPUT_SLOT_SUMMARY)
    expect(stepSummary(createImageLayerStep('logo'), NAME)).toBe('logo.png')
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

  it('counts the steps in a group and says when it has a picture of its own', () => {
    const group = createGroupStep([createSharpStep('flip')])

    expect(stepSummary(group, NAME)).toBe('1 step')
    expect(stepSummary({ ...group, subDocument: true }, NAME)).toBe(
      '1 step · own picture',
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
