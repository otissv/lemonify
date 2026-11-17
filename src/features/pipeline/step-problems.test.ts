import { AiToolId } from '@/features/ai/ai-tools'
import { describe, expect, it } from 'vitest'

import {
  createAiStep,
  createGroupStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import {
  pipelineStepLabel,
  pipelineStepTitle,
  stepProblem,
} from '@/features/pipeline/step-problems'

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

describe('the name of a group', () => {
  it('is Group until it is named', () => {
    const group = createGroupStep([createSharpStep('blur')])
    expect(pipelineStepLabel(group)).toBe('Group')
    expect(pipelineStepTitle(group)).toBe('Group')
    expect(pipelineStepTitle({ ...group, name: 'Look' })).toBe('Look')
  })
})
