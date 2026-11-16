import { describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { DEFAULT_LAYER_SETTINGS } from '@/features/pipeline/layer'
import {
  createAiStep,
  createLayerStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import type { LayerStep, PipelineStep } from '@/features/pipeline/pipeline'

import { planKey, planPipeline } from './plan-pipeline.ts'
import type { PlanLookups } from './plan-pipeline.ts'
import { renderKey } from './render-key.ts'

const SOURCE = { contentHash: 'a'.repeat(64), path: '/data/source' }
const SECOND = { contentHash: 'b'.repeat(64), path: '/data/second' }
const IMAGE = createLayerStep('base')
const UPSCALE = {
  tool: AiToolId.Upscale,
  settings: { model: 'm', scale: 4, iterations: 1, tta: false },
} as const

function lookups(results: Record<string, string> = {}): PlanLookups {
  return {
    aiResultPath: async (key) => results[key],
    source: async (id) =>
      ({ base: SOURCE, second: SECOND, copy: SECOND, gone: undefined })[id],
  }
}

/** The layer as the render key sees it: its image named by its content hash. */
function keyed(layer: LayerStep): LayerStep {
  return { ...layer, sourceId: SECOND.contentHash }
}

describe('planPipeline', () => {
  it('applies Sharp steps to the document’s image', async () => {
    const blur = createSharpStep('blur', { sigma: 2 })
    const plan = await planPipeline([IMAGE, blur], lookups())
    expect(plan.basePath).toBe(SOURCE.path)
    expect(plan.steps).toEqual([blur])
    expect(plan.applied).toEqual([blur])
    expect(plan.pending).toEqual([])
    expect(planKey(plan)).toBe(renderKey(SOURCE.contentHash, [blur]))
  })

  it('hands a step’s blend to the engine and keys the picture by it', async () => {
    const blend = { mode: 'multiply' as const, opacity: 50 }
    const blur = { ...createSharpStep('blur', { sigma: 2 }), blend }
    const plain = createSharpStep('blur', { sigma: 2 })

    const blended = await planPipeline([IMAGE, blur], lookups())
    const unblended = await planPipeline([IMAGE, plain], lookups())

    expect(blended.steps[0]).toMatchObject({ blend })
    expect(planKey(blended)).not.toBe(planKey(unblended))
  })

  it('leaves out steps that are switched off', async () => {
    const off = { ...createSharpStep('flip'), enabled: false }
    const plan = await planPipeline([IMAGE, off], lookups())
    expect(plan.applied).toEqual([])
  })

  it('skips a step that is not set up and says why', async () => {
    const resize = createSharpStep('extract')
    const flip = createSharpStep('flip')
    const plan = await planPipeline([IMAGE, resize, flip], lookups())
    expect(plan.applied).toEqual([flip])
    expect(plan.skipped).toHaveLength(1)
    expect(plan.skipped[0]?.stepId).toBe(resize.id)
  })

  describe('a step that uses a second image', () => {
    const boolean = (operand: string) =>
      createSharpStep('boolean', { operand, operator: 'and' })

    it('finds the image in the library, whether or not the document uses it elsewhere', async () => {
      const step = boolean('second')
      const plan = await planPipeline([IMAGE, step], lookups())
      expect(plan.steps[0]).toMatchObject({
        options: { operand: '/data/second' },
      })
      expect(plan.applied).toEqual([step])
    })

    it('skips a step whose second image is gone', async () => {
      const plan = await planPipeline([IMAGE, boolean('gone')], lookups())
      expect(plan.applied).toEqual([])
      expect(plan.skipped[0]?.message).toMatch(/no longer available/)
    })

    it('is keyed by the image’s content, not its id', async () => {
      const ai = createAiStep(UPSCALE)
      const first = await planPipeline(
        [IMAGE, boolean('second'), ai],
        lookups(),
      )
      const copy = await planPipeline([IMAGE, boolean('copy'), ai], lookups())

      expect(copy.aiKeys.get(ai.id)).toBe(first.aiKeys.get(ai.id))
      expect(planKey(copy)).toBe(planKey(first))
    })
  })

  it('stops at an AI step with no Result and holds everything after it', async () => {
    const before = createSharpStep('flip')
    const ai = createAiStep(UPSCALE)
    const after = createSharpStep('flop')
    const later = createAiStep(UPSCALE)
    const steps: PipelineStep[] = [before, ai, after, later]
    const plan = await planPipeline([IMAGE, ...steps], lookups())
    expect(plan.applied).toEqual([before])
    expect(plan.pending.map(({ step }) => step.id)).toEqual([ai.id, later.id])
    expect(plan.pending[0]?.key).toBe(
      renderKey(SOURCE.contentHash, [before, ai]),
    )
  })

  it('starts from the last AI step that has a Result', async () => {
    const before = createSharpStep('flip')
    const ai = createAiStep(UPSCALE)
    const after = createSharpStep('flop')
    const key = renderKey(SOURCE.contentHash, [before, ai])
    const plan = await planPipeline(
      [IMAGE, before, ai, after],
      lookups({ [key]: '/results/one' }),
    )
    expect(plan.basePath).toBe('/results/one')
    expect(plan.steps).toEqual([after])
    expect(plan.applied).toEqual([before, ai, after])
    expect(plan.pending).toEqual([])
  })

  describe('the canvas layer', () => {
    it('is the picture the steps start from, at its own size', async () => {
      const plan = await planPipeline([IMAGE], lookups())
      expect(plan.basePath).toBe(SOURCE.path)
      expect(plan.sourceHash).toBe(SOURCE.contentHash)
      expect(plan.steps).toEqual([])
      expect(plan.applied).toEqual([])
    })

    it('ignores its own settings, which only matter once it is drawn on something', async () => {
      const faint = { ...IMAGE, opacity: 20, blend: 'multiply' as const }

      const plain = await planPipeline([IMAGE], lookups())
      const set = await planPipeline([faint], lookups())

      expect(planKey(set)).toBe(planKey(plain))
      expect(set.steps).toEqual([])
    })

    it('is the first layer that is switched on', async () => {
      const off = { ...IMAGE, enabled: false }
      const second = createLayerStep('second')

      const plan = await planPipeline(
        [off, second, createSharpStep('flip')],
        lookups(),
      )

      expect(plan.basePath).toBe(SECOND.path)
      expect(plan.sourceHash).toBe(SECOND.contentHash)
    })

    it('passes to the next layer when its image is gone, and says so', async () => {
      const gone = createLayerStep('gone')

      const plan = await planPipeline([gone, IMAGE], lookups())

      expect(plan.basePath).toBe(SOURCE.path)
      expect(plan.skipped).toEqual([
        {
          stepId: gone.id,
          message: expect.stringMatching(/no longer available/),
        },
      ])
    })

    it('has to exist for there to be a picture', async () => {
      const off = { ...IMAGE, enabled: false }
      await expect(
        planPipeline([off, createSharpStep('flip')], lookups()),
      ).rejects.toThrow(/no image/i)
      await expect(planPipeline([], lookups())).rejects.toThrow(/no image/i)
      await expect(
        planPipeline([createLayerStep('gone')], lookups()),
      ).rejects.toThrow(/no image/i)
    })

    it('leaves out the steps before it, which have no picture to work on', async () => {
      const flip = createSharpStep('flip')
      const plan = await planPipeline([flip, IMAGE], lookups())
      expect(plan.applied).toEqual([])
      expect(plan.skipped[0]).toMatchObject({ stepId: flip.id })
      expect(plan.skipped[0]?.message).toMatch(/after the first layer/)
    })
  })

  describe('layers', () => {
    it('are applied in order with their image resolved to a file', async () => {
      const blur = createSharpStep('blur', { sigma: 2 })
      const layer = createLayerStep('second')
      const flip = createSharpStep('flip')

      const plan = await planPipeline([IMAGE, blur, layer, flip], lookups())

      expect(plan.applied).toEqual([blur, layer, flip])
      expect(plan.steps).toEqual([
        blur,
        {
          kind: 'layer',
          path: SECOND.path,
          ...DEFAULT_LAYER_SETTINGS,
        },
        flip,
      ])
      expect(planKey(plan)).toBe(
        renderKey(SOURCE.contentHash, [blur, keyed(layer), flip]),
      )
    })

    it('are left out when switched off, and do not change the key', async () => {
      const flip = createSharpStep('flip')
      const off = { ...createLayerStep('second'), enabled: false }

      const plain = await planPipeline([IMAGE, flip], lookups())
      const withOff = await planPipeline([IMAGE, off, flip], lookups())

      expect(withOff.steps).toEqual([flip])
      expect(planKey(withOff)).toBe(planKey(plain))
    })

    it('do not change the key when they are renamed', async () => {
      const layer = createLayerStep('second')
      const named = { ...layer, name: 'Watermark' }

      const plain = await planPipeline([IMAGE, layer], lookups())
      const renamed = await planPipeline([IMAGE, named], lookups())

      expect(planKey(renamed)).toBe(planKey(plain))
    })

    it('make the key change with their settings and their place among the steps', async () => {
      const flip = createSharpStep('flip')
      const layer = createLayerStep('second')
      const fainter = { ...layer, opacity: 50 }

      const keys = new Set([
        planKey(await planPipeline([IMAGE, flip, layer], lookups())),
        planKey(await planPipeline([IMAGE, layer, flip], lookups())),
        planKey(await planPipeline([IMAGE, flip, fainter], lookups())),
        planKey(await planPipeline([IMAGE, flip], lookups())),
      ])

      expect(keys.size).toBe(4)
    })

    it('are keyed by the image’s content, not its id', async () => {
      const one = await planPipeline(
        [IMAGE, createLayerStep('second')],
        lookups(),
      )
      const other = await planPipeline(
        [IMAGE, createLayerStep('copy')],
        lookups(),
      )

      expect(planKey(other)).toBe(planKey(one))
    })

    it('go into the key of an AI step after them, and are baked into its Result', async () => {
      const layer = createLayerStep('second')
      const ai = createAiStep(UPSCALE)
      const after = createLayerStep('second')
      const key = renderKey(SOURCE.contentHash, [keyed(layer), ai])

      const waiting = await planPipeline([IMAGE, layer, ai], lookups())
      const done = await planPipeline(
        [IMAGE, layer, ai, after],
        lookups({ [key]: '/results/one' }),
      )

      expect(waiting.pending[0]?.key).toBe(key)
      expect(done.basePath).toBe('/results/one')
      expect(done.steps).toMatchObject([{ kind: 'layer', path: SECOND.path }])
    })

    it('are skipped when their image is gone', async () => {
      const gone = createLayerStep('gone')

      const plan = await planPipeline([IMAGE, gone], lookups())

      expect(plan.applied).toEqual([])
      expect(plan.skipped).toEqual([
        {
          stepId: gone.id,
          message: expect.stringMatching(/no longer available/),
        },
      ])
    })
  })
})
