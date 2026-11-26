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
  createSharpStep,
  firstImageLayer,
  hasEdits,
  originalSourceId,
} from '@/features/pipeline/pipeline'
import {
  IMAGE_LAYER_KIND,
  createDocumentLayerStep,
  createImageLayerStep,
  createWorkflowLayerStep,
} from '@/features/pipeline/layer-kinds'
import {
  pipelineStepLabel,
  stepProblem,
} from '@/features/pipeline/step-problems'
import { pipelineOf } from '@/test/pipelines'

describe('the first image layer', () => {
  it('is the first image layer that is switched on', () => {
    const off = { ...createImageLayerStep('a'), enabled: false }
    const first = createImageLayerStep('b')
    const blur = createSharpStep('blur')

    expect(
      firstImageLayer(pipelineOf(blur, off, first, createImageLayerStep('c'))),
    ).toBe(first)
    expect(firstImageLayer(pipelineOf(blur, off))).toBeUndefined()
    expect(firstImageLayer(pipelineOf())).toBeUndefined()
  })

  it('passes over a layer that is empty, which has no image to show', () => {
    const empty = createImageLayerStep()
    const filled = createImageLayerStep('b')

    expect(firstImageLayer(pipelineOf(empty, filled))).toBe(filled)
    expect(firstImageLayer(pipelineOf(empty))).toBeUndefined()
    expect(originalSourceId(pipelineOf(empty, filled))).toBe('b')
    expect(originalSourceId(pipelineOf(empty))).toBeUndefined()
  })

  it('is an image layer: a document or workflow layer, even with an image, is not the original', () => {
    const workflow = createWorkflowLayerStep('w1', 'a')
    const image = createImageLayerStep('b')

    expect(
      firstImageLayer(
        pipelineOf(createDocumentLayerStep('d1'), workflow, image),
      ),
    ).toBe(image)
    expect(originalSourceId(pipelineOf(workflow))).toBeUndefined()
  })

  it('does not count as an edit, but any other step does', () => {
    const base = createImageLayerStep('a')

    expect(hasEdits(pipelineOf(base))).toBe(false)
    expect(hasEdits(pipelineOf(base, createImageLayerStep('b')))).toBe(false)
    expect(hasEdits(pipelineOf(base, createSharpStep('blur')))).toBe(true)
    expect(hasEdits(pipelineOf(createSharpStep('blur')))).toBe(true)
    expect(hasEdits(pipelineOf())).toBe(false)
  })

  it('puts no limit on the order of steps or the number of layers', () => {
    const steps = [
      createSharpStep('blur'),
      createImageLayerStep('a'),
      createImageLayerStep('b'),
    ]

    expect(PipelineSchema.safeParse(pipelineOf(...steps)).success).toBe(true)
    expect(PipelineSchema.safeParse(pipelineOf()).success).toBe(true)
  })
})

describe('a layer step', () => {
  it('holds the id of its image and starts with the defaults', () => {
    const step = createImageLayerStep('src-2')

    expect(step).toEqual({
      id: expect.any(String),
      kind: IMAGE_LAYER_KIND,
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

  it('is called an image layer and is always set up', () => {
    const step = createImageLayerStep('src-2')

    expect(pipelineStepLabel(step)).toBe('Image layer')
    expect(stepProblem(step)).toBeUndefined()
  })

  it('fills in settings that a saved layer leaves out', () => {
    const { id } = createImageLayerStep('src-2')

    const parsed = PipelineSchema.parse({
      ...pipelineOf(),
      steps: [{ id, kind: 'image-layer', sourceId: 'src-2', opacity: 40 }],
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
    const step = { ...createImageLayerStep('src-2'), ...change }

    expect(
      PipelineSchema.safeParse({ ...pipelineOf(), steps: [step] }).success,
    ).toBe(false)
  })

  it('counts as an image the pipeline uses', () => {
    const image = createImageLayerStep('src-1')
    const layer = createImageLayerStep('src-2')
    const boolean = createSharpStep('boolean', { operand: 'src-3' })

    expect(stepOperandSourceIds(layer)).toEqual(['src-2'])
    expect(
      pipelineOperandSourceIds(pipelineOf(image, layer, boolean, layer)),
    ).toEqual(['src-1', 'src-2', 'src-3'])
  })

  it('has its image renamed when a pipeline moves to another place', () => {
    const image = createImageLayerStep('a')
    const layer = createImageLayerStep('b')

    const moved = remapPipelineSources(
      pipelineOf(image, layer),
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

    expect(PipelineSchema.safeParse(pipelineOf(composite)).success).toBe(false)
  })
})

describe('changing layers', () => {
  const image = createImageLayerStep('a')
  const layer = createImageLayerStep('b')
  const pipeline = pipelineOf(image, layer)

  it('adds, moves and removes a layer like any other step, and undoes each', () => {
    const added = planChange(pipelineOf(image), {
      type: 'add-step',
      step: layer,
      index: 1,
    })

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
      applyChange(pipelineOf(image, blur), {
        type: 'set-layer',
        stepId: blur.id,
        settings: DEFAULT_LAYER_SETTINGS,
      }),
    ).toThrow(InvalidChangeError)
    expect(() =>
      applyChange(pipelineOf(image, blur), {
        type: 'set-image',
        stepId: blur.id,
        sourceId: 'c',
      }),
    ).toThrow(InvalidChangeError)
  })

  it('gives an image only to a layer that draws one: not to a document layer', () => {
    const documentLayer = createDocumentLayerStep('d1')
    const workflowLayer = createWorkflowLayerStep('w1')
    const change = {
      type: 'set-image',
      stepId: documentLayer.id,
      sourceId: 'c',
    } as const

    expect(() => applyChange(pipelineOf(documentLayer), change)).toThrow(
      InvalidChangeError,
    )
    expect(() => planChange(pipelineOf(documentLayer), change)).toThrow(
      InvalidChangeError,
    )
    expect(
      applyChange(pipelineOf(workflowLayer), {
        type: 'set-image',
        stepId: workflowLayer.id,
        sourceId: 'c',
      }).steps[0],
    ).toMatchObject({ sourceId: 'c' })
  })

  it('swaps the image of a layer, keeping everything else', () => {
    const changed = applyChange(pipelineOf(image, { ...layer, opacity: 20 }), {
      type: 'set-image',
      stepId: layer.id,
      sourceId: 'c',
    })

    expect(changed.steps[1]).toMatchObject({ sourceId: 'c', opacity: 20 })
  })

  it('fills an empty layer with an image, and empties it again, as changes that undo each other', () => {
    const empty = createImageLayerStep()
    const start = pipelineOf(empty)

    const planned = planChange(start, {
      type: 'set-image',
      stepId: empty.id,
      sourceId: 'c',
    })
    if (planned === null) throw new Error('expected a change')
    expect(planned.pipeline.steps[0]).toMatchObject({ sourceId: 'c' })
    expect(planned.patch.inverse).toEqual({
      type: 'set-image',
      stepId: empty.id,
      sourceId: null,
    })
    expect(applyChange(planned.pipeline, planned.patch.inverse)).toEqual(start)

    const emptied = planChange(planned.pipeline, {
      type: 'set-image',
      stepId: empty.id,
      sourceId: null,
    })
    if (emptied === null) throw new Error('expected a change')
    expect(emptied.pipeline.steps[0]).not.toHaveProperty('sourceId')
    expect(emptied.patch.inverse).toEqual({
      type: 'set-image',
      stepId: empty.id,
      sourceId: 'c',
    })
  })

  it('keeps the settings of a layer that is emptied', () => {
    const layer = { ...createImageLayerStep('a'), opacity: 30, rotation: 45 }

    const emptied = applyChange(pipelineOf(layer), {
      type: 'set-image',
      stepId: layer.id,
      sourceId: null,
    })

    expect(emptied.steps[0]).toMatchObject({ opacity: 30, rotation: 45 })
  })

  it('lets any layer, the first too, be hidden, moved and removed', () => {
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
      step: createImageLayerStep('c'),
      index: 0,
    })

    expect(added.steps).toHaveLength(3)
  })
})
