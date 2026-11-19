import { describe, expect, it } from 'vitest'

import { createGroupStep, createSharpStep } from '@/features/pipeline/pipeline'
import { stepsBefore } from '@/features/pipeline/step-input'
import { pipelineOf } from '@/test/pipelines'

describe('stepsBefore', () => {
  it('is the steps ahead of a step on the canvas', () => {
    const first = createSharpStep('resize')
    const second = createSharpStep('extract')
    const third = createSharpStep('sharpen')
    const pipeline = pipelineOf(first, second, third)

    expect(stepsBefore(pipeline, second.id)).toEqual([first])
    expect(stepsBefore(pipeline, first.id)).toEqual([])
  })

  it('lists the steps of a group that is not a sub-document as if it were not there', () => {
    const before = createSharpStep('resize')
    const inner = createSharpStep('rotate')
    const target = createSharpStep('extract')
    const group = createGroupStep([inner, target])
    const pipeline = pipelineOf(before, group)

    expect(stepsBefore(pipeline, target.id)).toEqual([before, inner])
  })

  it('is the picture of its own for a step inside a sub-document', () => {
    const outside = createSharpStep('resize')
    const inner = createSharpStep('rotate')
    const target = createSharpStep('extract')
    const group = { ...createGroupStep([inner, target]), subDocument: true }
    const pipeline = pipelineOf(outside, group)

    expect(stepsBefore(pipeline, target.id)).toEqual([inner])
    expect(stepsBefore(pipeline, inner.id)).toEqual([])
  })

  it('treats the steps of a group that is off as off', () => {
    const inner = createSharpStep('rotate')
    const target = createSharpStep('extract')
    const group = { ...createGroupStep([inner, target]), enabled: false }

    expect(stepsBefore(pipelineOf(group), target.id)).toEqual([
      { ...inner, enabled: false },
    ])
  })

  it('has nothing for a step that is not there, or a sub-document itself', () => {
    const inner = createSharpStep('rotate')
    const group = { ...createGroupStep([inner]), subDocument: true }
    const pipeline = pipelineOf(group)

    expect(stepsBefore(pipeline, 'missing')).toBeUndefined()
    expect(stepsBefore(pipeline, group.id)).toEqual([])
  })
})
