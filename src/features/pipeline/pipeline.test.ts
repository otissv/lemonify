import { AiToolId } from '@/features/ai/ai-tools'
import { describe, expect, it } from 'vitest'

import {
  PipelineSchema,
  PipelineStepKind,
  createSharpStep,
  createAiStep,
  insertStep,
  moveStep,
  removeStep,
  replaceStep,
  setStepEnabled,
} from '@/features/pipeline/pipeline'
import type { Pipeline } from '@/features/pipeline/pipeline'
import type { UpscaleSettings } from '@/features/upscale/upscale-settings'

const SETTINGS: UpscaleSettings = {
  model: 'siax',
  scale: 4,
  noise: undefined,
  iterations: 1,
  tta: false,
}

const EMPTY: Pipeline = { steps: [] }

function threeSteps(): Pipeline {
  const first = createSharpStep('resize')
  const second = createSharpStep('sharpen')
  const third = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
  return { steps: [first, second, third] }
}

function ids(pipeline: Pipeline): Array<string> {
  return pipeline.steps.map((step) => step.id)
}

describe('PipelineSchema', () => {
  it('accepts an empty pipeline and steps of both kinds', () => {
    expect(PipelineSchema.safeParse(EMPTY).success).toBe(true)
    expect(PipelineSchema.safeParse(threeSteps()).success).toBe(true)
  })

  it('has no positions: a pipeline is a line, not a canvas', () => {
    const step = createSharpStep('resize')

    expect(Object.keys(step)).not.toContain('position')
  })

  it('treats a saved step without `enabled` as on', () => {
    const { enabled: _enabled, ...saved } = createSharpStep('resize')

    const parsed = PipelineSchema.parse({ steps: [saved] })

    expect(parsed.steps.at(0)?.enabled).toBe(true)
  })

  it('rejects an unknown Sharp tool', () => {
    const bad = { steps: [{ ...createSharpStep('resize'), op: 'sparkle' }] }

    expect(PipelineSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects the same step twice', () => {
    const step = createSharpStep('resize')

    expect(PipelineSchema.safeParse({ steps: [step, step] }).success).toBe(
      false,
    )
  })

  it('rejects the Output group: Export covers those tools', () => {
    const bad = { steps: [{ ...createSharpStep('resize'), op: 'jpeg' }] }

    expect(PipelineSchema.safeParse(bad).success).toBe(false)
  })
})

describe('step creation', () => {
  it('makes a new Sharp step with default options, switched on', () => {
    expect(createSharpStep('blur')).toMatchObject({
      kind: PipelineStepKind.Sharp,
      op: 'blur',
      options: {},
      enabled: true,
    })
  })

  it('makes an AI step from its settings', () => {
    expect(
      createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS }),
    ).toMatchObject({
      kind: PipelineStepKind.Ai,
      tool: AiToolId.Upscale,
      settings: SETTINGS,
      enabled: true,
    })
  })

  it('gives every step its own id', () => {
    expect(createSharpStep('resize').id).not.toBe(createSharpStep('resize').id)
  })
})

describe('insertStep', () => {
  it('adds to the end by default', () => {
    const pipeline = threeSteps()
    const added = createSharpStep('blur')

    expect(ids(insertStep(pipeline, added))).toEqual([
      ...ids(pipeline),
      added.id,
    ])
  })

  it('inserts at an index, and clamps one that is out of range', () => {
    const pipeline = threeSteps()
    const added = createSharpStep('blur')

    expect(insertStep(pipeline, added, 1).steps.at(1)?.id).toBe(added.id)
    expect(insertStep(pipeline, added, 99).steps.at(-1)?.id).toBe(added.id)
    expect(insertStep(pipeline, added, -4).steps.at(0)?.id).toBe(added.id)
  })

  it('does not change the pipeline it was given', () => {
    const pipeline = threeSteps()

    insertStep(pipeline, createSharpStep('blur'))

    expect(pipeline.steps).toHaveLength(3)
  })
})

describe('removeStep', () => {
  it('removes one step and keeps the order of the rest', () => {
    const pipeline = threeSteps()
    const [first, second, third] = ids(pipeline)

    expect(ids(removeStep(pipeline, second))).toEqual([first, third])
  })

  it('leaves the pipeline alone for an unknown id', () => {
    const pipeline = threeSteps()

    expect(removeStep(pipeline, crypto.randomUUID())).toEqual(pipeline)
  })
})

describe('moveStep', () => {
  it('moves a step to a new place', () => {
    const pipeline = threeSteps()
    const [first, second, third] = ids(pipeline)

    expect(ids(moveStep(pipeline, third, 0))).toEqual([third, first, second])
    expect(ids(moveStep(pipeline, first, 2))).toEqual([second, third, first])
  })

  it('clamps the place to the ends', () => {
    const pipeline = threeSteps()
    const [first, second, third] = ids(pipeline)

    expect(ids(moveStep(pipeline, first, 99))).toEqual([second, third, first])
  })

  it('leaves the pipeline alone for an unknown id', () => {
    const pipeline = threeSteps()

    expect(moveStep(pipeline, crypto.randomUUID(), 0)).toEqual(pipeline)
  })
})

describe('setStepEnabled and replaceStep', () => {
  it('switches one step off and on without touching the others', () => {
    const pipeline = threeSteps()
    const target = pipeline.steps.at(1)

    const off = setStepEnabled(pipeline, target?.id ?? '', false)

    expect(off.steps.map((step) => step.enabled)).toEqual([true, false, true])
    expect(setStepEnabled(off, target?.id ?? '', true)).toEqual(pipeline)
  })

  it('replaces a step in place, by id', () => {
    const pipeline = threeSteps()
    const target = pipeline.steps.at(0)
    if (target?.kind !== PipelineStepKind.Sharp) throw new Error('not sharp')

    const next = replaceStep(pipeline, { ...target, options: { width: 800 } })

    expect(next.steps.at(0)).toMatchObject({
      id: target.id,
      options: { width: 800 },
    })
    expect(ids(next)).toEqual(ids(pipeline))
  })
})
