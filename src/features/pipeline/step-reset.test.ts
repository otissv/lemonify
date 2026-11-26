import { describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import {
  DocumentChangeSchema,
  InvalidChangeError,
  applyChange,
  planChange,
} from '@/features/pipeline/document-change'
import type { DocumentChange } from '@/features/pipeline/document-change'
import { DEFAULT_LAYER_SETTINGS } from '@/features/pipeline/layer'
import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import {
  createAiStep,
  createEmbeddedDocumentStep,
  createGroupStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import type { Pipeline, PipelineStep } from '@/features/pipeline/pipeline'
import { resetChangeFor, resetStep } from '@/features/pipeline/step-reset'
import { pipelineOf } from '@/test/pipelines'

const SETTINGS = { model: 'siax', scale: 2, iterations: 2, tta: true }
const STARTING_AI = {
  tool: AiToolId.Upscale,
  settings: { model: 'siax', scale: 4, iterations: 1, tta: false },
} as const

/** Resets one step, checks that one undo puts it back, and gives the step after the reset. */
function reset(pipeline: Pipeline, change: DocumentChange): PipelineStep {
  const planned = planChange(pipeline, change)
  if (planned === null) throw new Error('expected a change')
  expect(applyChange(planned.pipeline, planned.patch.inverse)).toEqual(pipeline)
  const stepId = 'stepId' in change ? change.stepId : ''
  const step = planned.pipeline.steps.find(({ id }) => id === stepId)
  if (!step) throw new Error('step gone')
  return step
}

describe('reset-step', () => {
  it('puts a Sharp step back to the options a new one starts with, and takes its blend away', () => {
    const tint = {
      ...createSharpStep('tint', { colour: '#00ff00' }),
      name: 'Green',
      blend: { mode: 'multiply' as const, opacity: 40 },
    }
    const pipeline = pipelineOf(tint)

    const step = reset(pipeline, resetChangeFor(tint))

    expect(step).toMatchObject({
      op: 'tint',
      options: { colour: '#ff0000' },
      name: 'Green',
      enabled: true,
    })
    expect(step).not.toHaveProperty('blend')
  })

  it("gives a step that needs another image the document's own image", () => {
    const layer = createImageLayerStep('src-photo')
    const boolean = createSharpStep('boolean', { operator: 'or' })
    const pipeline = pipelineOf(layer, boolean)

    const step = reset(pipeline, resetChangeFor(boolean))

    expect(step).toMatchObject({
      options: { operator: 'and', operand: 'src-photo' },
    })
  })

  it('puts a layer back to the default placement and keeps its image', () => {
    const layer = {
      ...createImageLayerStep('src-logo'),
      opacity: 30,
      scale: 250,
      anchor: 'southeast' as const,
    }
    const pipeline = pipelineOf(layer)

    const step = reset(pipeline, resetChangeFor(layer))

    expect(step).toMatchObject({ ...DEFAULT_LAYER_SETTINGS })
    expect(step).toEqual({ ...layer, ...DEFAULT_LAYER_SETTINGS })
  })

  it('puts the placement of an embedded document layer back, keeping its steps', () => {
    const embedded = {
      ...createEmbeddedDocumentStep([createSharpStep('blur')]),
      rotation: 45,
    }
    const pipeline = pipelineOf(embedded)

    const step = reset(pipeline, resetChangeFor(embedded))

    expect(step).toEqual({ ...embedded, ...DEFAULT_LAYER_SETTINGS })
  })

  it('leaves a group as it is, since it has nothing to reset', () => {
    const group = createGroupStep([createSharpStep('blur')])

    expect(resetStep(pipelineOf(group), group, {})).toEqual(group)
  })

  it('puts an AI step back to the settings its catalogue starts from', () => {
    const upscale = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    const pipeline = pipelineOf(upscale)

    const step = reset(pipeline, resetChangeFor(upscale, { ai: STARTING_AI }))

    expect(step).toMatchObject({ settings: STARTING_AI.settings })
  })

  it('puts a resize back to the size of the picture it acts on', () => {
    const resize = createSharpStep('resize', { width: 100, height: 40 })
    const pipeline = pipelineOf(resize)
    const size = { width: 800, height: 600 }

    const step = reset(pipeline, resetChangeFor(resize, { size }))

    expect(step).toMatchObject({ options: { width: 800, height: 600 } })
  })

  it('refuses a size that is no picture', () => {
    const resize = createSharpStep('resize', { width: 100 })

    expect(() =>
      DocumentChangeSchema.parse({
        type: 'reset-step',
        stepId: resize.id,
        size: { width: 0, height: 10 },
      }),
    ).toThrow()
  })

  it('refuses to reset an AI step without the settings to go back to', () => {
    const upscale = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })

    expect(() =>
      applyChange(pipelineOf(upscale), {
        type: 'reset-step',
        stepId: upscale.id,
      }),
    ).toThrow(InvalidChangeError)
  })

  it('records nothing when the step is already as a new one starts', () => {
    const scale = createSharpStep('scale', { percent: 100 })

    expect(planChange(pipelineOf(scale), resetChangeFor(scale))).toBeNull()
  })

  it('refuses a step that is gone', () => {
    expect(() =>
      applyChange(pipelineOf(), { type: 'reset-step', stepId: 'gone' }),
    ).toThrow(InvalidChangeError)
  })
})

describe('restore-step', () => {
  it('puts a step back as it was, which is how a reset is undone', () => {
    const scale = createSharpStep('scale', { percent: 250 })
    const changed = { ...scale, options: { percent: 100 } }

    expect(
      applyChange(pipelineOf(changed), { type: 'restore-step', step: scale })
        .steps[0],
    ).toEqual(scale)
  })

  it('refuses a step that is not in the pipeline', () => {
    expect(() =>
      applyChange(pipelineOf(), {
        type: 'restore-step',
        step: createSharpStep('blur'),
      }),
    ).toThrow(InvalidChangeError)
  })
})
