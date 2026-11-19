import { describe, expect, it } from 'vitest'

import { createGroupStep, createSharpStep } from '@/features/pipeline/pipeline'
import { viewedStepId } from '@/features/overlay/viewed-step'
import { pipelineOf } from '@/test/pipelines'

describe('viewedStepId', () => {
  it('is the selected step when a tool can draw on the picture for it', () => {
    const extract = createSharpStep('extract')
    expect(viewedStepId(extract.id, pipelineOf(extract))).toBe(extract.id)
  })

  it('is a step inside a group too', () => {
    const extract = createSharpStep('extract')
    const pipeline = pipelineOf(createGroupStep([extract]))
    expect(viewedStepId(extract.id, pipeline)).toBe(extract.id)
  })

  it('is nothing for a step no tool draws on, or nothing selected, or a step that is gone', () => {
    const blur = createSharpStep('blur')
    const pipeline = pipelineOf(blur)
    expect(viewedStepId(blur.id, pipeline)).toBeUndefined()
    expect(viewedStepId(undefined, pipeline)).toBeUndefined()
    expect(viewedStepId('gone', pipeline)).toBeUndefined()
  })
})
