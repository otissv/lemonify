import { AiToolId } from '@/features/ai/ai-tools'
import { describe, expect, it } from 'vitest'

import { createSharpStep, createAiStep } from '@/features/pipeline/pipeline'
import { stepProblem } from '@/features/pipeline/step-problems'

describe('stepProblem', () => {
  it('has none for a step that is set up', () => {
    expect(stepProblem(createSharpStep('blur', { sigma: 2 }))).toBeUndefined()
    expect(stepProblem(createSharpStep('flip'))).toBeUndefined()
  })

  it('names the options a step still needs', () => {
    expect(stepProblem(createSharpStep('extract'))).toBe(
      'Needs left, top, width, height.',
    )
  })

  it('says what is wrong with a value', () => {
    expect(stepProblem(createSharpStep('blur', { sigma: 0 }))).toBe(
      'sigma: Must be at least 0.3.',
    )
  })

  it('reports a problem that involves the step as a whole', () => {
    expect(stepProblem(createSharpStep('blur', { precision: 'float' }))).toBe(
      'blur needs sigma when minAmplitude or precision is set',
    )
  })

  it('has none for an upscale step', () => {
    expect(
      stepProblem(
        createAiStep({
          tool: AiToolId.Upscale,
          settings: { model: 'siax', scale: 4, iterations: 1, tta: false },
        }),
      ),
    ).toBeUndefined()
  })
})
