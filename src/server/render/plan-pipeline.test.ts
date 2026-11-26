import { describe, expect, it } from 'vitest'

import { canvasIdentity, canvasOfSize } from '@/features/pipeline/canvas'
import { AiToolId } from '@/features/ai/ai-tools'
import { DEFAULT_LAYER_SETTINGS } from '@/features/pipeline/layer'
import {
  createAiStep,
  createEmbeddedDocumentStep,
  createGroupStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import type { LeafStep, PipelineStep } from '@/features/pipeline/pipeline'
import type { ImageLayerStep } from '@/features/pipeline/layer-kinds'

import { awaitingPlan, planKey, planPipeline } from './plan-pipeline.ts'
import type { PlanLookups } from './plan-pipeline.ts'
import { renderKey } from './render-key.ts'

const CANVAS = canvasOfSize(10, 10)
const BASE_KEY = canvasIdentity(CANVAS)
const SOURCE = {
  contentHash: 'a'.repeat(64),
  path: '/data/source',
  width: 10,
  height: 10,
}
const SECOND = {
  contentHash: 'b'.repeat(64),
  path: '/data/second',
  width: 10,
  height: 10,
}
const UPSCALE = {
  tool: AiToolId.Upscale,
  settings: { model: 'm', scale: 4, iterations: 1, tta: false },
} as const

function lookups(results: Record<string, string> = {}): PlanLookups {
  return {
    aiResultPath: async (key) => results[key],
    source: async (id) =>
      ({ base: SOURCE, second: SECOND, copy: SECOND, gone: undefined })[id],
    used: async () => undefined,
  }
}

/** The layer as the render key sees it: its image named by its content hash. */
function keyed(layer: ImageLayerStep): ImageLayerStep {
  return { ...layer, sourceId: SECOND.contentHash }
}

function waitingKey(
  plan: { pending: ReadonlyArray<{ step: { id: string }; key: string }> },
  stepId: string,
): string {
  return plan.pending.find(({ step }) => step.id === stepId)?.key ?? ''
}

describe('planPipeline', () => {
  it('applies Sharp steps to the blank canvas', async () => {
    const blur = createSharpStep('blur', { sigma: 2 })
    const plan = await planPipeline(CANVAS, [blur], lookups())
    expect(plan.base).toEqual({ kind: 'canvas', canvas: CANVAS })
    expect(plan.baseKey).toBe(BASE_KEY)
    expect(plan.steps).toEqual([blur])
    expect(plan.applied).toEqual([blur])
    expect(plan.pending).toEqual([])
    expect(planKey(plan)).toBe(renderKey(BASE_KEY, [blur]))
  })

  it('hands a step’s blend to the engine and keys the picture by it', async () => {
    const blend = { mode: 'multiply' as const, opacity: 50 }
    const blur = { ...createSharpStep('blur', { sigma: 2 }), blend }
    const plain = createSharpStep('blur', { sigma: 2 })

    const blended = await planPipeline(CANVAS, [blur], lookups())
    const unblended = await planPipeline(CANVAS, [plain], lookups())

    expect(blended.steps[0]).toMatchObject({ blend })
    expect(planKey(blended)).not.toBe(planKey(unblended))
  })

  it('leaves out steps that are switched off', async () => {
    const off = { ...createSharpStep('flip'), enabled: false }
    const plan = await planPipeline(CANVAS, [off], lookups())
    expect(plan.applied).toEqual([])
  })

  it('skips a step that is not set up and says why', async () => {
    const resize = createSharpStep('extract')
    const flip = createSharpStep('flip')
    const plan = await planPipeline(CANVAS, [resize, flip], lookups())
    expect(plan.applied).toEqual([flip])
    expect(plan.skipped).toHaveLength(1)
    expect(plan.skipped[0]?.stepId).toBe(resize.id)
  })

  describe('a step that uses a second image', () => {
    const boolean = (operand: string) =>
      createSharpStep('boolean', { operand, operator: 'and' })

    it('finds the image in the library, whether or not the document uses it elsewhere', async () => {
      const step = boolean('second')
      const plan = await planPipeline(CANVAS, [step], lookups())
      expect(plan.steps[0]).toMatchObject({
        options: { operand: '/data/second' },
      })
      expect(plan.applied).toEqual([step])
    })

    it('skips a step whose second image is gone', async () => {
      const plan = await planPipeline(CANVAS, [boolean('gone')], lookups())
      expect(plan.applied).toEqual([])
      expect(plan.skipped[0]?.message).toMatch(/no longer available/)
    })

    it('is keyed by the image’s content, not its id', async () => {
      const ai = createAiStep(UPSCALE)
      const first = await planPipeline(
        CANVAS,
        [boolean('second'), ai],
        lookups(),
      )
      const copy = await planPipeline(CANVAS, [boolean('copy'), ai], lookups())

      expect(copy.aiKeys.get(ai.id)).toBe(first.aiKeys.get(ai.id))
      expect(planKey(copy)).toBe(planKey(first))
    })
  })

  it('stops at an AI step with no Result and holds everything after it', async () => {
    const before = createSharpStep('flip')
    const ai = createAiStep(UPSCALE)
    const after = createSharpStep('flop')
    const later = createAiStep(UPSCALE)
    const steps: LeafStep[] = [before, ai, after, later]
    const plan = await planPipeline(CANVAS, steps, lookups())
    expect(plan.applied).toEqual([before])
    expect(plan.pending.map(({ step }) => step.id)).toEqual([ai.id, later.id])
    expect(plan.pending[0]?.key).toBe(renderKey(BASE_KEY, [before, ai]))
  })

  it('starts from the last AI step that has a Result', async () => {
    const before = createSharpStep('flip')
    const ai = createAiStep(UPSCALE)
    const after = createSharpStep('flop')
    const key = renderKey(BASE_KEY, [before, ai])
    const plan = await planPipeline(
      CANVAS,
      [before, ai, after],
      lookups({ [key]: '/results/one' }),
    )
    expect(plan.base).toEqual({ kind: 'file', path: '/results/one' })
    expect(plan.baseKey).toBe(BASE_KEY)
    expect(plan.steps).toEqual([after])
    expect(plan.applied).toEqual([before, ai, after])
    expect(plan.pending).toEqual([])
  })

  describe('the canvas', () => {
    it('is the picture every plan starts from, with no layer needed', async () => {
      const plan = await planPipeline(CANVAS, [], lookups())
      expect(plan.base).toEqual({ kind: 'canvas', canvas: CANVAS })
      expect(plan.steps).toEqual([])
      expect(plan.applied).toEqual([])
      expect(plan.originalFrom).toBeUndefined()
    })

    it('is part of the key: another size or background is another picture', async () => {
      const blur = createSharpStep('blur', { sigma: 2 })
      const keys = new Set([
        planKey(await planPipeline(CANVAS, [blur], lookups())),
        planKey(await planPipeline(canvasOfSize(20, 10), [blur], lookups())),
        planKey(
          await planPipeline(
            { ...CANVAS, background: '#ff0000' },
            [blur],
            lookups(),
          ),
        ),
      ])
      expect(keys.size).toBe(3)
    })

    it('does not make any layer special: the first is drawn like the others, with its settings', async () => {
      const faint = { ...createImageLayerStep('base'), opacity: 20 }

      const plan = await planPipeline(CANVAS, [faint], lookups())

      expect(plan.applied).toEqual([faint])
      expect(plan.steps).toEqual([
        {
          kind: 'layer',
          path: SOURCE.path,
          ...DEFAULT_LAYER_SETTINGS,
          opacity: 20,
        },
      ])
    })

    it('lets the steps before the first layer work on the blank canvas', async () => {
      const flip = createSharpStep('flip')
      const plan = await planPipeline(
        CANVAS,
        [flip, createImageLayerStep('base')],
        lookups(),
      )
      expect(plan.applied).toHaveLength(2)
      expect(plan.skipped).toEqual([])
    })

    it('names the first applied layer’s file as the original, passing over one that is off or gone', async () => {
      const off = { ...createImageLayerStep('base'), enabled: false }
      const gone = createImageLayerStep('gone')
      const second = createImageLayerStep('second')

      const plan = await planPipeline(CANVAS, [off, gone, second], lookups())

      expect(plan.originalFrom).toBe(SECOND.path)
    })
  })

  describe('layers', () => {
    it('are applied in order with their image resolved to a file', async () => {
      const blur = createSharpStep('blur', { sigma: 2 })
      const layer = createImageLayerStep('second')
      const flip = createSharpStep('flip')

      const plan = await planPipeline(CANVAS, [blur, layer, flip], lookups())

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
        renderKey(BASE_KEY, [blur, keyed(layer), flip]),
      )
    })

    it('are left out when switched off, and do not change the key', async () => {
      const flip = createSharpStep('flip')
      const off = { ...createImageLayerStep('second'), enabled: false }

      const plain = await planPipeline(CANVAS, [flip], lookups())
      const withOff = await planPipeline(CANVAS, [off, flip], lookups())

      expect(withOff.steps).toEqual([flip])
      expect(planKey(withOff)).toBe(planKey(plain))
    })

    it('do not change the key when they are renamed', async () => {
      const layer = createImageLayerStep('second')
      const named = { ...layer, name: 'Watermark' }

      const plain = await planPipeline(CANVAS, [layer], lookups())
      const renamed = await planPipeline(CANVAS, [named], lookups())

      expect(planKey(renamed)).toBe(planKey(plain))
    })

    it('make the key change with their settings and their place among the steps', async () => {
      const flip = createSharpStep('flip')
      const layer = createImageLayerStep('second')
      const fainter = { ...layer, opacity: 50 }

      const keys = new Set([
        planKey(await planPipeline(CANVAS, [flip, layer], lookups())),
        planKey(await planPipeline(CANVAS, [layer, flip], lookups())),
        planKey(await planPipeline(CANVAS, [flip, fainter], lookups())),
        planKey(await planPipeline(CANVAS, [flip], lookups())),
      ])

      expect(keys.size).toBe(4)
    })

    it('are keyed by the image’s content, not its id', async () => {
      const one = await planPipeline(
        CANVAS,
        [createImageLayerStep('second')],
        lookups(),
      )
      const other = await planPipeline(
        CANVAS,
        [createImageLayerStep('copy')],
        lookups(),
      )

      expect(planKey(other)).toBe(planKey(one))
    })

    it('go into the key of an AI step after them, and are baked into its Result', async () => {
      const layer = createImageLayerStep('second')
      const ai = createAiStep(UPSCALE)
      const after = createImageLayerStep('second')
      const key = renderKey(BASE_KEY, [keyed(layer), ai])

      const waiting = await planPipeline(CANVAS, [layer, ai], lookups())
      const done = await planPipeline(
        CANVAS,
        [layer, ai, after],
        lookups({ [key]: '/results/one' }),
      )

      expect(waiting.pending[0]?.key).toBe(key)
      expect(done.base).toEqual({ kind: 'file', path: '/results/one' })
      expect(done.steps).toMatchObject([{ kind: 'layer', path: SECOND.path }])
    })

    it('are left out without a message while they have no image, and do not change the key', async () => {
      const flip = createSharpStep('flip')
      const empty = createImageLayerStep()

      const plain = await planPipeline(CANVAS, [flip], lookups())
      const withEmpty = await planPipeline(CANVAS, [empty, flip], lookups())

      expect(withEmpty.applied).toEqual([flip])
      expect(withEmpty.steps).toEqual([flip])
      expect(withEmpty.skipped).toEqual([])
      expect(withEmpty.originalFrom).toBeUndefined()
      expect(planKey(withEmpty)).toBe(planKey(plain))
    })

    it('are drawn once they are given an image', async () => {
      const empty = createImageLayerStep()
      const filled = { ...empty, sourceId: 'second' }

      const before = await planPipeline(CANVAS, [empty], lookups())
      const after = await planPipeline(CANVAS, [filled], lookups())

      expect(before.steps).toEqual([])
      expect(after.steps).toMatchObject([{ kind: 'layer', path: SECOND.path }])
      expect(planKey(after)).not.toBe(planKey(before))
    })

    it('are skipped when their image is gone', async () => {
      const gone = createImageLayerStep('gone')

      const plan = await planPipeline(CANVAS, [gone], lookups())

      expect(plan.applied).toEqual([])
      expect(plan.skipped).toEqual([
        {
          stepId: gone.id,
          message: expect.stringMatching(/no longer available/),
        },
      ])
    })
  })

  describe('an embedded document layer', () => {
    const embedded = (steps: PipelineStep[], settings = {}) => ({
      ...createEmbeddedDocumentStep(steps, 'Logo'),
      ...settings,
    })

    it('is a picture of its own on the same canvas, with its layers drawn on it, and placed like a layer', async () => {
      const blur = createSharpStep('blur', { sigma: 2 })
      const layer = createImageLayerStep('second')
      const group = embedded([layer, blur], { opacity: 40 })

      const plan = await planPipeline(CANVAS, [group], lookups())

      expect(plan.base).toEqual({ kind: 'canvas', canvas: CANVAS })
      expect(plan.steps).toEqual([
        {
          kind: 'embedded-document',
          input: { kind: 'canvas', canvas: CANVAS },
          steps: [
            { kind: 'layer', path: SECOND.path, ...DEFAULT_LAYER_SETTINGS },
            blur,
          ],
          ...DEFAULT_LAYER_SETTINGS,
          opacity: 40,
        },
      ])
      expect(plan.applied).toEqual([group])
    })

    it('is applied even when none of its layers is on: it is then a transparent picture', async () => {
      const off = { ...createImageLayerStep('second'), enabled: false }
      const flip = createSharpStep('flip')
      const group = embedded([off, flip])

      const plan = await planPipeline(CANVAS, [group], lookups())

      expect(plan.skipped).toEqual([])
      expect(plan.applied).toEqual([group])
      expect(plan.subPlans.get(group.id)?.steps).toEqual([flip])
    })

    it('says so when its image is gone, and is still applied', async () => {
      const gone = createImageLayerStep('gone')
      const group = embedded([gone])

      const plan = await planPipeline(CANVAS, [group], lookups())

      expect(plan.applied).toEqual([group])
      expect(plan.skipped).toEqual([
        {
          stepId: gone.id,
          message: expect.stringMatching(/no longer available/),
        },
      ])
    })

    it('plans the embedded document layers inside it as pictures of their own, and opens its groups', async () => {
      const blur = createSharpStep('blur', { sigma: 2 })
      const flip = createSharpStep('flip')
      const inner = embedded([createGroupStep([flip])], { x: 3 })
      const outer = embedded([createGroupStep([blur]), inner])

      const plan = await planPipeline(CANVAS, [outer], lookups())

      const outerPlan = plan.subPlans.get(outer.id)
      expect(outerPlan?.applied).toEqual([blur, inner])
      expect(outerPlan?.subPlans.get(inner.id)?.applied).toEqual([flip])
      expect(plan.steps).toEqual([
        {
          kind: 'embedded-document',
          input: { kind: 'canvas', canvas: CANVAS },
          steps: [
            blur,
            {
              kind: 'embedded-document',
              input: { kind: 'canvas', canvas: CANVAS },
              steps: [flip],
              ...DEFAULT_LAYER_SETTINGS,
              x: 3,
            },
          ],
          ...DEFAULT_LAYER_SETTINGS,
        },
      ])
    })

    it('has a key of its own, unlike a group', async () => {
      const blur = createSharpStep('blur', { sigma: 2 })
      const layer = createImageLayerStep('second')
      const plain = createGroupStep([layer, blur])
      const sub = { ...createEmbeddedDocumentStep(plain.steps), id: plain.id }

      const flat = await planPipeline(CANVAS, [layer, blur], lookups())
      const grouped = await planPipeline(CANVAS, [layer, blur], lookups())
      const separate = await planPipeline(CANVAS, [sub], lookups())

      expect(planKey(grouped)).toBe(planKey(flat))
      expect(planKey(separate)).not.toBe(planKey(flat))
    })

    it('changes the key with its steps, its image and its placement, not with names or ids', async () => {
      const make = (
        settings = {},
        sigma = 2,
        image = 'second',
        name = 'A',
      ) => ({
        ...embedded(
          [createImageLayerStep(image), createSharpStep('blur', { sigma })],
          settings,
        ),
        name,
      })
      const key = async (group: ReturnType<typeof make>) =>
        planKey(await planPipeline(CANVAS, [group], lookups()))

      const keys = new Set([
        await key(make()),
        await key(make({ opacity: 50 })),
        await key(make({}, 3)),
        await key(make({}, 2, 'base')),
      ])
      expect(keys.size).toBe(4)
      expect(await key(make())).toBe(await key(make({}, 2, 'copy', 'B')))
    })

    describe('with an AI step in it', () => {
      const upscale = createAiStep(UPSCALE)
      const layer = createImageLayerStep('second')
      const group = () => embedded([layer, createSharpStep('flip'), upscale])

      it('waits for it, under a key made from its own picture, and holds what comes after', async () => {
        const g = group()
        const after = createAiStep(UPSCALE)
        const flop = createSharpStep('flop')

        const plan = await planPipeline(CANVAS, [g, flop, after], lookups())

        const key = plan.aiKeys.get(upscale.id)
        expect(key).toBe(
          renderKey(BASE_KEY, [keyed(layer), g.steps[1] as LeafStep, upscale]),
        )
        expect(plan.pending.map(({ step }) => step.id)).toEqual([
          upscale.id,
          after.id,
        ])
        expect(plan.applied).toEqual([])
        expect(awaitingPlan(plan, waitingKey(plan, upscale.id))?.base).toEqual({
          kind: 'canvas',
          canvas: CANVAS,
        })
        expect(
          awaitingPlan(plan, waitingKey(plan, upscale.id))?.steps,
        ).toMatchObject([{ kind: 'layer', path: SECOND.path }, g.steps[1]])
        expect(awaitingPlan(plan, waitingKey(plan, after.id))).toBe(plan)
      })

      it('starts from its result once it has one, keeping the steps after it', async () => {
        const g = embedded([layer, upscale, createSharpStep('flop')])
        const waiting = await planPipeline(CANVAS, [g], lookups())
        const key = waiting.aiKeys.get(upscale.id) ?? ''

        const plan = await planPipeline(
          CANVAS,
          [g],
          lookups({ [key]: '/results/logo' }),
        )

        expect(plan.pending).toEqual([])
        expect(plan.steps).toMatchObject([
          {
            kind: 'embedded-document',
            input: { kind: 'file', path: '/results/logo' },
            steps: [g.steps[2]],
          },
        ])
        expect(plan.base).toEqual({ kind: 'canvas', canvas: CANVAS })
      })

      it('does not move the key of an AI step after it when its own result arrives', async () => {
        const g = group()
        const later = createAiStep(UPSCALE)
        const waiting = await planPipeline(CANVAS, [g, later], lookups())
        const key = waiting.aiKeys.get(upscale.id) ?? ''

        const done = await planPipeline(
          CANVAS,
          [g, later],
          lookups({ [key]: '/results/logo' }),
        )

        expect(done.aiKeys.get(later.id)).toBe(waiting.aiKeys.get(later.id))
      })
    })
  })
})
