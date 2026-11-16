import { describe, expect, it } from 'vitest'

import { applyChange, planChange } from '@/features/pipeline/document-change'
import {
  PipelineSchema,
  createAiStep,
  createLayerStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import {
  DEFAULT_STEP_BLEND,
  blendableOps,
  stepBlendSchema,
  supportsBlend,
} from '@/features/pipeline/step-blend'
import { AiToolId } from '@/features/ai/ai-tools'

const BLUR = createSharpStep('blur', { sigma: 2 })
const FLIP = createSharpStep('flip')
const LAYER = createLayerStep('logo')
const UPSCALE = createAiStep({
  tool: AiToolId.Upscale,
  settings: { model: 'm', scale: 4, iterations: 1, tta: false },
})
const PIPELINE = { steps: [LAYER, BLUR, FLIP, UPSCALE] }

describe('which steps have a blend', () => {
  it('are the filters and the colour tools, which keep the size of the picture', () => {
    for (const op of [
      'blur',
      'sharpen',
      'negate',
      'modulate',
      'tint',
      'greyscale',
    ]) {
      expect(supportsBlend(op)).toBe(true)
    }
    expect(blendableOps()).toContain('threshold')
  })

  it('leave out the geometry tools, which change the size, and the tools that are about opacity or layering', () => {
    for (const op of [
      'resize',
      'scale',
      'rotate',
      'extract',
      'flip',
      'opacity',
      'composite',
    ]) {
      expect(supportsBlend(op)).toBe(false)
    }
  })
})

describe('a blend', () => {
  it('has a mode and an opacity, which default to normal and 100', () => {
    expect(stepBlendSchema.parse({})).toEqual(DEFAULT_STEP_BLEND)
    expect(DEFAULT_STEP_BLEND).toEqual({ mode: 'normal', opacity: 100 })
  })

  it.each([
    ['an opacity above 100', { opacity: 101 }],
    ['a negative opacity', { opacity: -1 }],
    ['a mode it does not know', { mode: 'dissolve' }],
    ['a setting that is not its own', { colour: 'red' }],
  ])('refuses %s', (_name, blend) => {
    expect(stepBlendSchema.safeParse(blend).success).toBe(false)
  })

  it('is kept on a step that can have one, and refused on one that cannot', () => {
    const blend = { mode: 'multiply', opacity: 40 }

    expect(
      PipelineSchema.safeParse({ steps: [LAYER, { ...BLUR, blend }] }).success,
    ).toBe(true)
    expect(
      PipelineSchema.safeParse({ steps: [LAYER, { ...FLIP, blend }] }).success,
    ).toBe(false)
  })
})

describe('the set-blend change', () => {
  const blend = { mode: 'multiply', opacity: 40 } as const

  it('sets the blend of a step, and its inverse puts back what was there', () => {
    const planned = planChange(PIPELINE, {
      type: 'set-blend',
      stepId: BLUR.id,
      blend,
    })

    expect(planned?.pipeline.steps[1]).toMatchObject({ blend })
    expect(planned?.patch.inverse).toEqual({
      type: 'set-blend',
      stepId: BLUR.id,
      blend: null,
    })
    const again = planChange(planned?.pipeline ?? PIPELINE, {
      type: 'set-blend',
      stepId: BLUR.id,
      blend: { mode: 'screen', opacity: 10 },
    })
    expect(again?.patch.inverse).toEqual({
      type: 'set-blend',
      stepId: BLUR.id,
      blend,
    })
  })

  it('takes the blend away for null, and for the defaults, which do nothing', () => {
    const blended = applyChange(PIPELINE, {
      type: 'set-blend',
      stepId: BLUR.id,
      blend,
    })

    for (const none of [null, DEFAULT_STEP_BLEND]) {
      const cleared = applyChange(blended, {
        type: 'set-blend',
        stepId: BLUR.id,
        blend: none,
      })
      expect(cleared.steps[1]).not.toHaveProperty('blend')
    }
  })

  it('records nothing when the blend is the same', () => {
    expect(
      planChange(PIPELINE, { type: 'set-blend', stepId: BLUR.id, blend: null }),
    ).toBeNull()
  })

  it('refuses a step that cannot have one: geometry, an AI step, a layer, or a step that is not there', () => {
    for (const stepId of [FLIP.id, UPSCALE.id, LAYER.id, 'gone']) {
      expect(() =>
        applyChange(PIPELINE, { type: 'set-blend', stepId, blend }),
      ).toThrow()
    }
  })
})
