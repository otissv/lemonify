import { describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import {
  createAiStep,
  createSharpStep,
  createSourceStep,
} from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'

import { planKey, planPipeline } from './plan-pipeline.ts'
import type { PlanLookups } from './plan-pipeline.ts'
import { renderKey } from './render-key.ts'

const SOURCE = { contentHash: 'a'.repeat(64), path: '/data/source' }
const SECOND = { contentHash: 'b'.repeat(64), path: '/data/second' }
const OPEN = createSourceStep('base')
const OPEN_SECOND = createSourceStep('second')
const UPSCALE = {
  tool: AiToolId.Upscale,
  settings: { model: 'm', scale: 4, iterations: 1, tta: false },
} as const

function lookups(results: Record<string, string> = {}): PlanLookups {
  return {
    aiResultPath: async (key) => results[key],
    source: async (id) =>
      ({ base: SOURCE, second: SECOND, gone: undefined })[id],
  }
}

describe('planPipeline', () => {
  it('applies Sharp steps to the Source', async () => {
    const blur = createSharpStep('blur', { sigma: 2 })
    const plan = await planPipeline([OPEN, ...[blur]], lookups())
    expect(plan.basePath).toBe(SOURCE.path)
    expect(plan.sharpSteps).toEqual([blur])
    expect(plan.applied).toEqual([blur])
    expect(plan.pending).toEqual([])
    expect(planKey(plan)).toBe(renderKey(SOURCE.contentHash, [blur]))
  })

  it('leaves out steps that are switched off', async () => {
    const off = { ...createSharpStep('flip'), enabled: false }
    const plan = await planPipeline([OPEN, ...[off]], lookups())
    expect(plan.applied).toEqual([])
  })

  it('skips a step that is not set up and says why', async () => {
    const resize = createSharpStep('extract')
    const flip = createSharpStep('flip')
    const plan = await planPipeline([OPEN, resize, flip], lookups())
    expect(plan.applied).toEqual([flip])
    expect(plan.skipped).toHaveLength(1)
    expect(plan.skipped[0]?.stepId).toBe(resize.id)
  })

  it('resolves a second image to its path', async () => {
    const step = createSharpStep('boolean', {
      operand: 'second',
      operator: 'and',
    })
    const plan = await planPipeline([OPEN, OPEN_SECOND, step], lookups())
    expect(plan.sharpSteps[0]?.options).toMatchObject({
      operand: '/data/second',
    })
    expect(plan.applied).toEqual([step])
  })

  it('skips a step whose second image is gone', async () => {
    const step = createSharpStep('boolean', {
      operand: 'gone',
      operator: 'and',
    })
    const plan = await planPipeline(
      [OPEN, createSourceStep('gone'), step],
      lookups(),
    )
    expect(plan.applied).toEqual([])
    expect(plan.skipped[0]?.message).toMatch(/no longer available/)
  })

  it('stops at an AI step with no Result and holds everything after it', async () => {
    const before = createSharpStep('flip')
    const ai = createAiStep(UPSCALE)
    const after = createSharpStep('flop')
    const later = createAiStep(UPSCALE)
    const steps: PipelineStep[] = [before, ai, after, later]
    const plan = await planPipeline([OPEN, ...steps], lookups())
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
      [OPEN, before, ai, after],
      lookups({ [key]: '/results/one' }),
    )
    expect(plan.basePath).toBe('/results/one')
    expect(plan.sharpSteps).toEqual([after])
    expect(plan.applied).toEqual([before, ai, after])
    expect(plan.pending).toEqual([])
  })

  describe('Open image steps', () => {
    it('starts from the first one that is switched on', async () => {
      const off = { ...createSourceStep('second'), enabled: false }
      const plan = await planPipeline([off, OPEN, OPEN_SECOND], lookups())
      expect(plan.basePath).toBe(SOURCE.path)
      expect(plan.sourceHash).toBe(SOURCE.contentHash)
      expect(plan.applied).toEqual([])
    })

    it('makes the same picture key whichever extra images are opened', async () => {
      const flip = createSharpStep('flip')
      const plain = await planPipeline([OPEN, flip], lookups())
      const withExtra = await planPipeline([OPEN, OPEN_SECOND, flip], lookups())
      expect(planKey(withExtra)).toBe(planKey(plain))
    })

    it('refuses a plan with no image switched on', async () => {
      const off = { ...OPEN, enabled: false }
      await expect(
        planPipeline([off, createSharpStep('flip')], lookups()),
      ).rejects.toThrow(/Open image/)
      await expect(planPipeline([], lookups())).rejects.toThrow(/Open image/)
    })

    it('skips a step that comes before any image is opened', async () => {
      const flip = createSharpStep('flip')
      const plan = await planPipeline([flip, OPEN], lookups())
      expect(plan.applied).toEqual([])
      expect(plan.skipped[0]).toMatchObject({ stepId: flip.id })
      expect(plan.skipped[0]?.message).toMatch(/Open an image first/)
    })

    it('skips a step that uses an image that is not opened before it', async () => {
      const step = createSharpStep('boolean', {
        operand: 'second',
        operator: 'and',
      })
      const before = await planPipeline([OPEN, step, OPEN_SECOND], lookups())
      expect(before.applied).toEqual([])
      expect(before.skipped[0]?.message).toMatch(/Open that image/)
      const off = { ...OPEN_SECOND, enabled: false }
      const switchedOff = await planPipeline([OPEN, off, step], lookups())
      expect(switchedOff.skipped[0]?.message).toMatch(/Open that image/)
    })

    it('skips an opened image that no longer exists', async () => {
      const gone = createSourceStep('gone')
      const plan = await planPipeline([OPEN, gone], lookups())
      expect(plan.skipped).toEqual([
        {
          stepId: gone.id,
          message: expect.stringMatching(/no longer available/),
        },
      ])
    })
  })
})
