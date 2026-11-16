import { describe, expect, it } from 'vitest'

import {
  InvalidChangeError,
  applyChange,
  planChange,
} from '@/features/pipeline/document-change'
import {
  pipelineOperandSourceIds,
  remapPipelineSources,
  stepOperandSourceIds,
} from '@/features/pipeline/image-operands'
import { DEFAULT_LAYER_SETTINGS } from '@/features/pipeline/layer'
import {
  PipelineSchema,
  PipelineStepKind,
  createLayerStep,
  createSharpStep,
  canvasLayer,
  hasEdits,
} from '@/features/pipeline/pipeline'
import {
  pipelineStepLabel,
  stepProblem,
} from '@/features/pipeline/step-problems'

describe('the canvas layer', () => {
  it('is the first layer that is switched on', () => {
    const off = { ...createLayerStep('a'), enabled: false }
    const first = createLayerStep('b')
    const blur = createSharpStep('blur')

    expect(
      canvasLayer({ steps: [blur, off, first, createLayerStep('c')] }),
    ).toBe(first)
    expect(canvasLayer({ steps: [blur, off] })).toBeUndefined()
    expect(canvasLayer({ steps: [] })).toBeUndefined()
  })

  it('does not count as an edit, but any other step does', () => {
    const base = createLayerStep('a')

    expect(hasEdits({ steps: [base] })).toBe(false)
    expect(hasEdits({ steps: [base, createLayerStep('b')] })).toBe(true)
    expect(hasEdits({ steps: [base, createSharpStep('blur')] })).toBe(true)
    expect(hasEdits({ steps: [createSharpStep('blur')] })).toBe(true)
    expect(hasEdits({ steps: [] })).toBe(false)
  })

  it('puts no limit on the order of steps or the number of layers', () => {
    const steps = [
      createSharpStep('blur'),
      createLayerStep('a'),
      createLayerStep('b'),
    ]

    expect(PipelineSchema.safeParse({ steps }).success).toBe(true)
    expect(PipelineSchema.safeParse({ steps: [] }).success).toBe(true)
  })
})

describe('a layer step', () => {
  it('holds the id of its image and starts with the defaults', () => {
    const step = createLayerStep('src-2')

    expect(step).toEqual({
      id: expect.any(String),
      kind: PipelineStepKind.Layer,
      sourceId: 'src-2',
      enabled: true,
      ...DEFAULT_LAYER_SETTINGS,
    })
    expect(DEFAULT_LAYER_SETTINGS).toEqual({
      opacity: 100,
      blend: 'normal',
      fit: 'inside',
      scale: 100,
      rotation: 0,
      anchor: 'centre',
      x: 0,
      y: 0,
    })
  })

  it('is called Layer and is always set up', () => {
    const step = createLayerStep('src-2')

    expect(pipelineStepLabel(step)).toBe('Layer')
    expect(stepProblem(step)).toBeUndefined()
  })

  it('fills in settings that a saved layer leaves out', () => {
    const { id } = createLayerStep('src-2')

    const parsed = PipelineSchema.parse({
      steps: [{ id, kind: 'layer', sourceId: 'src-2', opacity: 40 }],
    })

    expect(parsed.steps[0]).toMatchObject({
      enabled: true,
      opacity: 40,
      blend: 'normal',
      anchor: 'centre',
    })
  })

  it.each([
    ['an opacity above 100', { opacity: 101 }],
    ['a negative opacity', { opacity: -1 }],
    ['a scale of 0', { scale: 0 }],
    ['a scale above 1000', { scale: 1001 }],
    ['a rotation beyond a half turn', { rotation: 181 }],
    ['a blend mode it does not know', { blend: 'dissolve' }],
    ['a fit it does not know', { fit: 'tile' }],
    ['an anchor it does not know', { anchor: 'middle' }],
    ['a movement that is not whole pixels', { x: 1.5 }],
    ['a setting that is not one of its own', { colour: 'red' }],
  ])('refuses %s', (_name, change) => {
    const step = { ...createLayerStep('src-2'), ...change }

    expect(PipelineSchema.safeParse({ steps: [step] }).success).toBe(false)
  })

  it('counts as an image the pipeline uses', () => {
    const image = createLayerStep('src-1')
    const layer = createLayerStep('src-2')
    const boolean = createSharpStep('boolean', { operand: 'src-3' })

    expect(stepOperandSourceIds(layer)).toEqual(['src-2'])
    expect(
      pipelineOperandSourceIds({ steps: [image, layer, boolean, layer] }),
    ).toEqual(['src-1', 'src-2', 'src-3'])
  })

  it('has its image renamed when a pipeline moves to another place', () => {
    const image = createLayerStep('a')
    const layer = createLayerStep('b')

    const moved = remapPipelineSources(
      { steps: [image, layer] },
      new Map([
        ['a', 'x'],
        ['b', 'y'],
      ]),
    )

    expect(
      moved.steps.map((step) => 'sourceId' in step && step.sourceId),
    ).toEqual(['x', 'y'])
  })
})

describe('Composite is not an editing tool in a document', () => {
  it('is refused, since a layer does the same', () => {
    const composite = createSharpStep('composite', { images: [{ input: 'a' }] })

    expect(PipelineSchema.safeParse({ steps: [composite] }).success).toBe(false)
  })
})

describe('changing layers', () => {
  const image = createLayerStep('a')
  const layer = createLayerStep('b')
  const pipeline = { steps: [image, layer] }

  it('adds, moves and removes a layer like any other step, and undoes each', () => {
    const added = planChange(
      { steps: [image] },
      { type: 'add-step', step: layer, index: 1 },
    )

    expect(added?.pipeline.steps).toEqual([image, layer])
    expect(added?.patch.inverse).toEqual({
      type: 'remove-step',
      stepId: layer.id,
    })
  })

  it('changes the settings of a layer, and the inverse puts them back', () => {
    const planned = planChange(pipeline, {
      type: 'set-layer',
      stepId: layer.id,
      settings: { ...DEFAULT_LAYER_SETTINGS, opacity: 30, blend: 'multiply' },
    })

    expect(planned?.pipeline.steps[1]).toMatchObject({
      opacity: 30,
      blend: 'multiply',
      sourceId: 'b',
    })
    expect(planned?.patch.inverse).toEqual({
      type: 'set-layer',
      stepId: layer.id,
      settings: DEFAULT_LAYER_SETTINGS,
    })
  })

  it('records nothing when the settings are the same', () => {
    expect(
      planChange(pipeline, {
        type: 'set-layer',
        stepId: layer.id,
        settings: DEFAULT_LAYER_SETTINGS,
      }),
    ).toBeNull()
  })

  it('refuses settings that are not valid, and settings for a step that is not a layer', () => {
    const blur = createSharpStep('blur')
    expect(() =>
      applyChange(pipeline, {
        type: 'set-layer',
        stepId: layer.id,
        settings: { ...DEFAULT_LAYER_SETTINGS, opacity: 500 },
      }),
    ).toThrow(InvalidChangeError)
    expect(() =>
      applyChange(
        { steps: [image, blur] },
        {
          type: 'set-layer',
          stepId: blur.id,
          settings: DEFAULT_LAYER_SETTINGS,
        },
      ),
    ).toThrow(InvalidChangeError)
    expect(() =>
      applyChange(
        { steps: [image, blur] },
        { type: 'set-source', stepId: blur.id, sourceId: 'c' },
      ),
    ).toThrow(InvalidChangeError)
  })

  it('swaps the image of a layer, keeping everything else', () => {
    const changed = applyChange(
      { steps: [image, { ...layer, opacity: 20 }] },
      { type: 'set-source', stepId: layer.id, sourceId: 'c' },
    )

    expect(changed.steps[1]).toMatchObject({ sourceId: 'c', opacity: 20 })
  })

  it('lets any layer, the one that sets the canvas too, be hidden, moved and removed', () => {
    const hidden = applyChange(pipeline, {
      type: 'set-enabled',
      stepId: image.id,
      enabled: false,
    })
    const moved = applyChange(pipeline, {
      type: 'move-step',
      stepId: image.id,
      to: 1,
    })
    const removed = applyChange(pipeline, {
      type: 'remove-step',
      stepId: image.id,
    })

    expect(hidden.steps[0]).toMatchObject({ enabled: false })
    expect(moved.steps.map(({ id }) => id)).toEqual([layer.id, image.id])
    expect(removed.steps).toEqual([layer])
    expect(
      applyChange(removed, { type: 'remove-step', stepId: layer.id }).steps,
    ).toEqual([])
  })

  it('adds a layer anywhere, even before the others', () => {
    const added = applyChange(pipeline, {
      type: 'add-step',
      step: createLayerStep('c'),
      index: 0,
    })

    expect(added.steps).toHaveLength(3)
  })
})
