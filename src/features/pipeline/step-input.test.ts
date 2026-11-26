import { describe, expect, it } from 'vitest'

import {
  createEmbeddedDocumentStep,
  createGroupStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import { stepsBefore, stepsThrough } from '@/features/pipeline/step-input'
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

  it('lists the steps of a group as if it were not there', () => {
    const before = createSharpStep('resize')
    const inner = createSharpStep('rotate')
    const target = createSharpStep('extract')
    const group = createGroupStep([inner, target])
    const pipeline = pipelineOf(before, group)

    expect(stepsBefore(pipeline, target.id)).toEqual([before, inner])
  })

  it('is the picture of its own for a step inside an embedded document layer', () => {
    const outside = createSharpStep('resize')
    const inner = createSharpStep('rotate')
    const target = createSharpStep('extract')
    const group = createEmbeddedDocumentStep([inner, target])
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

  it('has nothing for a step that is not there, or an embedded document layer itself', () => {
    const inner = createSharpStep('rotate')
    const group = createEmbeddedDocumentStep([inner])
    const pipeline = pipelineOf(group)

    expect(stepsBefore(pipeline, 'missing')).toBeUndefined()
    expect(stepsBefore(pipeline, group.id)).toEqual([])
  })
})

describe('stepsBefore with nesting', () => {
  it('is the innermost embedded document layer’s picture, with groups at any depth opened', () => {
    const outside = createSharpStep('resize')
    const first = createSharpStep('rotate')
    const second = createSharpStep('flip')
    const target = createSharpStep('extract')
    const inner = createEmbeddedDocumentStep([
      createGroupStep([first]),
      createGroupStep([createGroupStep([second, target])]),
    ])
    const outer = createEmbeddedDocumentStep([createSharpStep('blur'), inner])
    const pipeline = pipelineOf(outside, outer)

    expect(stepsBefore(pipeline, target.id)).toEqual([first, second])
    expect(stepsBefore(pipeline, inner.id)?.map(({ id }) => id)).toEqual([
      outer.steps[0]?.id,
    ])
  })

  it('opens an embedded document layer that is off into the picture around it', () => {
    const outside = createSharpStep('resize')
    const target = createSharpStep('extract')
    const off = { ...createEmbeddedDocumentStep([target]), enabled: false }
    const pipeline = pipelineOf(outside, off)

    expect(stepsBefore(pipeline, target.id)).toEqual([outside])
  })

  it('has nothing for a group, which is not a step of the picture', () => {
    const group = createGroupStep([createSharpStep('rotate')])

    expect(stepsBefore(pipelineOf(group), group.id)).toBeUndefined()
  })
})

describe('stepsThrough', () => {
  it('is the steps ahead of a step and the step itself', () => {
    const first = createSharpStep('resize')
    const second = createSharpStep('extract')
    const third = createSharpStep('sharpen')
    const pipeline = pipelineOf(first, second, third)

    expect(stepsThrough(pipeline, second.id)).toEqual([first, second])
    expect(stepsThrough(pipeline, third.id)).toEqual([first, second, third])
  })

  it('stays inside an embedded document layer for a step in one', () => {
    const outside = createSharpStep('resize')
    const inner = createSharpStep('rotate')
    const target = createSharpStep('extract')
    const group = createEmbeddedDocumentStep([inner, target])

    expect(stepsThrough(pipelineOf(outside, group), target.id)).toEqual([
      inner,
      target,
    ])
  })

  it('includes an embedded document layer that is the step, and has nothing for a step that is not there', () => {
    const inner = createSharpStep('rotate')
    const group = createEmbeddedDocumentStep([inner])
    const pipeline = pipelineOf(group)

    expect(stepsThrough(pipeline, group.id)).toEqual([group])
    expect(stepsThrough(pipeline, 'missing')).toBeUndefined()
  })
})
