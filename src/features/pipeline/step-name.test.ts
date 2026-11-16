import { describe, expect, it } from 'vitest'

import { applyChange, planChange } from '@/features/pipeline/document-change'
import {
  MAX_STEP_NAME_LENGTH,
  PipelineSchema,
  createAiStep,
  createLayerStep,
  createSharpStep,
  createSourceStep,
} from '@/features/pipeline/pipeline'
import type { Pipeline } from '@/features/pipeline/pipeline'
import {
  pipelineStepLabel,
  pipelineStepTitle,
} from '@/features/pipeline/step-problems'
import { AiToolId } from '@/features/ai/ai-tools'

const IMAGE = createSourceStep('base')
const BLUR = createSharpStep('blur', { sigma: 2 })
const LAYER = createLayerStep('logo')
const UPSCALE = createAiStep({
  tool: AiToolId.Upscale,
  settings: { model: 'm', scale: 4, iterations: 1, tta: false },
})
const PIPELINE: Pipeline = { steps: [IMAGE, BLUR, LAYER, UPSCALE] }

describe('step names', () => {
  it('are optional, on every kind of step, and trimmed', () => {
    const named = PIPELINE.steps.map((step) => ({ ...step, name: '  Hero  ' }))

    const parsed = PipelineSchema.parse({ steps: named })

    expect(parsed.steps.map((step) => step.name)).toEqual([
      'Hero',
      'Hero',
      'Hero',
      'Hero',
    ])
    expect(PipelineSchema.safeParse(PIPELINE).success).toBe(true)
  })

  it('are never empty or longer than the limit', () => {
    for (const name of ['', '   ', 'x'.repeat(MAX_STEP_NAME_LENGTH + 1)]) {
      expect(
        PipelineSchema.safeParse({ steps: [{ ...IMAGE, name }] }).success,
      ).toBe(false)
    }
  })

  it('title a step by its name, or by its tool when it has none', () => {
    expect(pipelineStepTitle(BLUR)).toBe('Blur')
    expect(pipelineStepTitle({ ...BLUR, name: 'Soften' })).toBe('Soften')
    expect(pipelineStepLabel({ ...BLUR, name: 'Soften' })).toBe('Blur')
  })

  describe('the rename-step change', () => {
    it('names any step, including the document’s image', () => {
      for (const step of PIPELINE.steps) {
        const next = applyChange(PIPELINE, {
          type: 'rename-step',
          stepId: step.id,
          name: 'Hero',
        })
        expect(next.steps.find(({ id }) => id === step.id)?.name).toBe('Hero')
      }
    })

    it('trims the name, and an empty one goes back to the tool’s own name', () => {
      const named = applyChange(PIPELINE, {
        type: 'rename-step',
        stepId: BLUR.id,
        name: '  Soften ',
      })
      const cleared = applyChange(named, {
        type: 'rename-step',
        stepId: BLUR.id,
        name: '   ',
      })

      expect(named.steps[1]?.name).toBe('Soften')
      expect(cleared.steps[1]).not.toHaveProperty('name')
    })

    it('is undone by restoring the earlier name, or none', () => {
      const first = planChange(PIPELINE, {
        type: 'rename-step',
        stepId: BLUR.id,
        name: 'Soften',
      })
      const second = planChange(first?.pipeline ?? PIPELINE, {
        type: 'rename-step',
        stepId: BLUR.id,
        name: 'Soften more',
      })

      expect(first?.patch.inverse).toEqual({
        type: 'rename-step',
        stepId: BLUR.id,
        name: '',
      })
      expect(second?.patch.inverse).toEqual({
        type: 'rename-step',
        stepId: BLUR.id,
        name: 'Soften',
      })
      expect(
        applyChange(
          second?.pipeline ?? PIPELINE,
          second?.patch.inverse ?? {
            type: 'rename-step',
            stepId: BLUR.id,
            name: '',
          },
        ).steps[1]?.name,
      ).toBe('Soften')
    })

    it('changes nothing when the name is the same', () => {
      expect(
        planChange(PIPELINE, {
          type: 'rename-step',
          stepId: BLUR.id,
          name: '',
        }),
      ).toBeNull()
    })

    it('refuses a step that is not there, and a name that is too long', () => {
      expect(() =>
        applyChange(PIPELINE, {
          type: 'rename-step',
          stepId: 'gone',
          name: 'x',
        }),
      ).toThrow()
      expect(() =>
        applyChange(PIPELINE, {
          type: 'rename-step',
          stepId: BLUR.id,
          name: 'x'.repeat(MAX_STEP_NAME_LENGTH + 1),
        }),
      ).toThrow()
    })
  })
})
