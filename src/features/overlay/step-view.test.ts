import { describe, expect, it } from 'vitest'

import { createGroupStep, createSharpStep } from '@/features/pipeline/pipeline'
import {
  StepViewPart,
  previewPictureRequest,
  sameStepView,
  stepViewOf,
} from '@/features/overlay/step-view'
import { pipelineOf } from '@/test/pipelines'

describe('stepViewOf', () => {
  it('is the chosen part of the selected step when a tool can draw on the picture for it', () => {
    const extract = createSharpStep('extract')
    const pipeline = pipelineOf(extract)
    expect(stepViewOf(extract.id, pipeline, StepViewPart.Tool)).toEqual({
      stepId: extract.id,
      part: StepViewPart.Tool,
    })
    expect(stepViewOf(extract.id, pipeline, StepViewPart.Output)?.part).toBe(
      StepViewPart.Output,
    )
  })

  it('is a step inside a group too', () => {
    const extract = createSharpStep('extract')
    const pipeline = pipelineOf(createGroupStep([extract]))
    expect(stepViewOf(extract.id, pipeline, StepViewPart.Tool)?.stepId).toBe(
      extract.id,
    )
  })

  it('is nothing for a step no tool draws on, nothing selected, or a step that is gone', () => {
    const blur = createSharpStep('blur')
    const pipeline = pipelineOf(blur)
    expect(stepViewOf(blur.id, pipeline, StepViewPart.Tool)).toBeUndefined()
    expect(stepViewOf(undefined, pipeline, StepViewPart.Tool)).toBeUndefined()
    expect(stepViewOf('gone', pipeline, StepViewPart.Tool)).toBeUndefined()
  })
})

describe('sameStepView', () => {
  it('compares the step and the part, and treats none as none', () => {
    const edit = { stepId: 'a', part: StepViewPart.Tool }
    expect(sameStepView(edit, { ...edit })).toBe(true)
    expect(sameStepView(edit, { ...edit, part: StepViewPart.Output })).toBe(
      false,
    )
    expect(sameStepView(undefined, undefined)).toBe(true)
    expect(sameStepView(edit, undefined)).toBe(false)
  })
})

describe('previewPictureRequest', () => {
  it('asks for the picture through the step for the output, whatever the tool', () => {
    const extract = createSharpStep('extract')
    expect(
      previewPictureRequest(pipelineOf(extract), {
        stepId: extract.id,
        part: StepViewPart.Output,
      }),
    ).toEqual({ throughStepId: extract.id })
  })

  it("asks for the tool's own picture the way the tool says", () => {
    const extract = createSharpStep('extract')
    expect(
      previewPictureRequest(pipelineOf(extract), {
        stepId: extract.id,
        part: StepViewPart.Tool,
      }),
    ).toEqual({ beforeStepId: extract.id })
  })

  it('asks for nothing special for a step that has no tool', () => {
    const blur = createSharpStep('blur')
    expect(
      previewPictureRequest(pipelineOf(blur), {
        stepId: blur.id,
        part: StepViewPart.Tool,
      }),
    ).toEqual({})
  })
})
