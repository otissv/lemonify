import { describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import {
  DocumentChangeSchema,
  HistoryPatchSchema,
  InvalidChangeError,
  applyChange,
  planChange,
} from '@/features/pipeline/document-change'
import type { DocumentChange } from '@/features/pipeline/document-change'
import { createSharpStep, createAiStep } from '@/features/pipeline/pipeline'
import type { Pipeline } from '@/features/pipeline/pipeline'
import { pipelineOf } from '@/test/pipelines'

const UPSCALE_SETTINGS = {
  model: 'siax',
  scale: 4,
  iterations: 1,
  tta: false,
}

function sharpPipeline(...ops: string[]): Pipeline {
  return pipelineOf(...ops.map((op) => createSharpStep(op)))
}

/** Applies a change, then its inverse, and expects the original back. */
function roundTrip(pipeline: Pipeline, change: DocumentChange): Pipeline {
  const planned = planChange(pipeline, change)
  if (planned === null) throw new Error('expected a change')
  expect(applyChange(planned.pipeline, planned.patch.inverse)).toEqual(pipeline)
  expect(applyChange(pipeline, planned.patch.forward)).toEqual(planned.pipeline)
  return planned.pipeline
}

describe('planChange', () => {
  it('adds a step at an index, and its inverse removes it', () => {
    const pipeline = sharpPipeline('blur', 'negate')
    const step = createSharpStep('flip')
    const next = roundTrip(pipeline, { type: 'add-step', step, index: 1 })
    expect(next.steps.map((s) => s.id)).toEqual([
      pipeline.steps[0]?.id,
      step.id,
      pipeline.steps[1]?.id,
    ])
  })

  it('clamps an index past the end to the end', () => {
    const pipeline = sharpPipeline('blur')
    const step = createSharpStep('flip')
    const next = roundTrip(pipeline, { type: 'add-step', step, index: 99 })
    expect(next.steps.at(-1)?.id).toBe(step.id)
  })

  it('removes a step, and its inverse puts it back where it was', () => {
    const pipeline = sharpPipeline('blur', 'negate', 'flip')
    const target = pipeline.steps[1]
    if (!target) throw new Error('missing step')
    const next = roundTrip(pipeline, { type: 'remove-step', stepId: target.id })
    expect(next.steps).toHaveLength(2)
  })

  it('moves a step, and its inverse moves it back', () => {
    const pipeline = sharpPipeline('blur', 'negate', 'flip')
    const first = pipeline.steps[0]
    if (!first) throw new Error('missing step')
    const next = roundTrip(pipeline, {
      type: 'move-step',
      stepId: first.id,
      to: 2,
    })
    expect(next.steps.at(-1)?.id).toBe(first.id)
  })

  it('sets the options of a Sharp step and restores the old ones', () => {
    const step = createSharpStep('blur', { sigma: 1 })
    const next = roundTrip(pipelineOf(step), {
      type: 'set-options',
      stepId: step.id,
      options: { sigma: 5 },
    })
    expect(next.steps[0]).toMatchObject({ options: { sigma: 5 } })
  })

  it('sets the settings of an AI step and restores the old ones', () => {
    const step = createAiStep({
      tool: AiToolId.Upscale,
      settings: UPSCALE_SETTINGS,
    })
    const next = roundTrip(pipelineOf(step), {
      type: 'set-settings',
      stepId: step.id,
      tool: AiToolId.Upscale,
      settings: { ...UPSCALE_SETTINGS, scale: 2 },
    })
    expect(next.steps[0]).toMatchObject({ settings: { scale: 2 } })
  })

  it('switches a step off and back on', () => {
    const step = createSharpStep('blur')
    const next = roundTrip(pipelineOf(step), {
      type: 'set-enabled',
      stepId: step.id,
      enabled: false,
    })
    expect(next.steps[0]?.enabled).toBe(false)
  })

  it('records nothing when the change leaves the Pipeline as it was', () => {
    const step = createSharpStep('blur', { sigma: 1 })
    const pipeline = pipelineOf(step)
    expect(
      planChange(pipeline, {
        type: 'set-options',
        stepId: step.id,
        options: { sigma: 1 },
      }),
    ).toBeNull()
    expect(
      planChange(pipeline, {
        type: 'set-enabled',
        stepId: step.id,
        enabled: true,
      }),
    ).toBeNull()
    expect(
      planChange(pipeline, { type: 'move-step', stepId: step.id, to: 0 }),
    ).toBeNull()
  })

  it('refuses a change to a step that is not there', () => {
    expect(() =>
      planChange(sharpPipeline('blur'), {
        type: 'remove-step',
        stepId: 'gone',
      }),
    ).toThrow(InvalidChangeError)
    expect(() =>
      planChange(sharpPipeline('blur'), {
        type: 'set-enabled',
        stepId: 'gone',
        enabled: false,
      }),
    ).toThrow(/no longer/)
  })

  it('refuses a step that is already in the Pipeline', () => {
    const pipeline = sharpPipeline('blur')
    const step = pipeline.steps[0]
    if (!step) throw new Error('missing step')
    expect(() =>
      planChange(pipeline, { type: 'add-step', step, index: 0 }),
    ).toThrow(/already/)
  })

  it('refuses options for an upscale step and settings for a Sharp step', () => {
    const upscale = createAiStep({
      tool: AiToolId.Upscale,
      settings: UPSCALE_SETTINGS,
    })
    const sharpStep = createSharpStep('blur')
    expect(() =>
      planChange(pipelineOf(upscale), {
        type: 'set-options',
        stepId: upscale.id,
        options: {},
      }),
    ).toThrow(/settings/)
    expect(() =>
      planChange(pipelineOf(sharpStep), {
        type: 'set-settings',
        stepId: sharpStep.id,
        tool: AiToolId.Upscale,
        settings: UPSCALE_SETTINGS,
      }),
    ).toThrow(/settings/)
  })
})

describe('schemas', () => {
  it('accept a patch built from a change', () => {
    const step = createSharpStep('blur')
    const planned = planChange(pipelineOf(), {
      type: 'add-step',
      step,
      index: 0,
    })
    expect(HistoryPatchSchema.parse(planned?.patch)).toEqual(planned?.patch)
  })

  it('reject an unknown change type and extra fields', () => {
    expect(DocumentChangeSchema.safeParse({ type: 'explode' }).success).toBe(
      false,
    )
    expect(
      DocumentChangeSchema.safeParse({
        type: 'remove-step',
        stepId: 'a',
        extra: 1,
      }).success,
    ).toBe(false)
  })
})
