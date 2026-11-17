import { describe, expect, it } from 'vitest'

import { DEFAULT_LAYER_SETTINGS } from '@/features/pipeline/layer'
import {
  IMAGE_LAYER_KIND,
  LAYER_KINDS,
  createImageLayerStep,
  isLayerStep,
  layerKind,
} from '@/features/pipeline/layer-kinds'
import { PipelineSchema, createSharpStep } from '@/features/pipeline/pipeline'
import { pipelineOf } from '@/test/pipelines'

const IMAGES = new Map([['a', 'hash-a']])

function lookup(images: Record<string, { path: string; contentHash: string }>) {
  return (id: string) => Promise.resolve(images[id])
}

describe('the layer kinds', () => {
  it('has the image layer and nothing else', () => {
    expect(Object.keys(LAYER_KINDS)).toEqual([IMAGE_LAYER_KIND])
    expect(IMAGE_LAYER_KIND).toBe('image-layer')
  })

  it('tells a layer of any kind from other steps', () => {
    expect(isLayerStep(createImageLayerStep('a'))).toBe(true)
    expect(isLayerStep(createSharpStep('blur'))).toBe(false)
  })

  it('accepts an image layer with no image yet, and refuses a kind it does not know', () => {
    const empty = createImageLayerStep()
    expect(empty.sourceId).toBeUndefined()
    expect(PipelineSchema.safeParse(pipelineOf(empty)).success).toBe(true)

    const unknown = { ...createImageLayerStep('a'), kind: 'text' }
    const old = { ...createImageLayerStep('a'), kind: 'layer' }
    for (const step of [unknown, old]) {
      expect(
        PipelineSchema.safeParse({ ...pipelineOf(), steps: [step] }).success,
      ).toBe(false)
    }
  })

  it('refuses a layer with an empty image id or a field it does not have', () => {
    for (const extra of [{ sourceId: '' }, { colour: 'red' }]) {
      const step = { ...createImageLayerStep('a'), ...extra }
      expect(
        PipelineSchema.safeParse({ ...pipelineOf(), steps: [step] }).success,
      ).toBe(false)
    }
  })

  describe('the image layer', () => {
    const kind = LAYER_KINDS[IMAGE_LAYER_KIND]

    it('is called an image layer', () => {
      expect(kind.title).toBe('Image layer')
    })

    it('owns the image it draws, and none when it is empty', () => {
      expect(kind.sourceIds(createImageLayerStep('a'))).toEqual(['a'])
      expect(kind.sourceIds(createImageLayerStep())).toEqual([])
    })

    it('names its image by another id, and leaves an empty layer as it is', () => {
      const layer = createImageLayerStep('a')
      expect(kind.withSourceIds(layer, IMAGES)).toEqual({
        ...layer,
        sourceId: 'hash-a',
      })
      const empty = createImageLayerStep()
      expect(kind.withSourceIds(empty, IMAGES)).toEqual(empty)
      expect(() =>
        kind.withSourceIds(createImageLayerStep('missing'), IMAGES),
      ).toThrow(RangeError)
    })

    it('is always set up, with or without an image', () => {
      expect(kind.problem(createImageLayerStep('a'))).toBeUndefined()
      expect(kind.problem(createImageLayerStep())).toBeUndefined()
    })

    it('says what a row shows: the image, what differs from the defaults, or that it is empty or gone', () => {
      const layer = createImageLayerStep('a')
      expect(kind.display(layer, 'logo.png')).toEqual({
        text: 'logo.png',
        problem: false,
      })
      expect(
        kind.display({ ...layer, opacity: 50, blend: 'multiply' }, 'logo.png')
          .text,
      ).toBe('logo.png · 50% · multiply')
      expect(kind.display(layer, undefined)).toEqual({
        text: 'Image not available',
        problem: true,
      })
      expect(kind.display(createImageLayerStep(), undefined)).toEqual({
        text: 'No image yet',
        problem: false,
      })
    })

    it('plans to draw the image from its file, keyed by its content', async () => {
      const layer = { ...createImageLayerStep('a'), opacity: 40 }
      const plan = await kind.plan(
        layer,
        lookup({ a: { path: '/data/a', contentHash: 'hash-a' } }),
      )
      expect(plan).toEqual({
        state: 'ready',
        path: '/data/a',
        identity: { ...layer, sourceId: 'hash-a' },
      })
    })

    it('plans to skip an empty layer without saying anything, and to report a missing image', async () => {
      expect(await kind.plan(createImageLayerStep(), lookup({}))).toEqual({
        state: 'empty',
      })
      expect(await kind.plan(createImageLayerStep('a'), lookup({}))).toEqual({
        state: 'gone',
      })
    })

    it('starts with the default settings, switched on', () => {
      expect(createImageLayerStep('a')).toEqual({
        id: expect.any(String),
        kind: IMAGE_LAYER_KIND,
        sourceId: 'a',
        enabled: true,
        ...DEFAULT_LAYER_SETTINGS,
      })
    })
  })

  it('finds the kind of a layer step', () => {
    const layer = createImageLayerStep('a')
    expect(layerKind(layer)).toBe(LAYER_KINDS[IMAGE_LAYER_KIND])
  })
})
