import { describe, expect, it } from 'vitest'

import { createGroupStep, createSharpStep } from '@/features/pipeline/pipeline'
import {
  StepViewPart,
  sameStepView,
  stepViewOf,
} from '@/features/overlay/step-view'
import { pipelineOf } from '@/test/pipelines'

describe('stepViewOf', () => {
  it('is the chosen part of the selected step when a tool can draw on the picture for it', () => {
    const extract = createSharpStep('extract')
    const pipeline = pipelineOf(extract)
    expect(stepViewOf(extract.id, pipeline, StepViewPart.Edit)).toEqual({
      stepId: extract.id,
      part: StepViewPart.Edit,
    })
    expect(stepViewOf(extract.id, pipeline, StepViewPart.Result)?.part).toBe(
      StepViewPart.Result,
    )
  })

  it('is a step inside a group too', () => {
    const extract = createSharpStep('extract')
    const pipeline = pipelineOf(createGroupStep([extract]))
    expect(stepViewOf(extract.id, pipeline, StepViewPart.Edit)?.stepId).toBe(
      extract.id,
    )
  })

  it('is nothing for a step no tool draws on, nothing selected, or a step that is gone', () => {
    const blur = createSharpStep('blur')
    const pipeline = pipelineOf(blur)
    expect(stepViewOf(blur.id, pipeline, StepViewPart.Edit)).toBeUndefined()
    expect(stepViewOf(undefined, pipeline, StepViewPart.Edit)).toBeUndefined()
    expect(stepViewOf('gone', pipeline, StepViewPart.Edit)).toBeUndefined()
  })
})

describe('sameStepView', () => {
  it('compares the step and the part, and treats none as none', () => {
    const edit = { stepId: 'a', part: StepViewPart.Edit }
    expect(sameStepView(edit, { ...edit })).toBe(true)
    expect(sameStepView(edit, { ...edit, part: StepViewPart.Result })).toBe(
      false,
    )
    expect(sameStepView(undefined, undefined)).toBe(true)
    expect(sameStepView(edit, undefined)).toBe(false)
  })
})
