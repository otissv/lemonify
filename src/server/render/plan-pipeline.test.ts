import { describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { createAiStep, createSharpStep } from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'

import { planKey, planPipeline } from './plan-pipeline.ts'
import type { PlanLookups } from './plan-pipeline.ts'
import { renderKey } from './render-key.ts'

const SOURCE = { contentHash: 'a'.repeat(64), path: '/data/source' }
const UPSCALE = {
  tool: AiToolId.Upscale,
  settings: { model: 'm', scale: 4, iterations: 1, tta: false },
} as const

function lookups(results: Record<string, string> = {}): PlanLookups {
  return {
    aiResultPath: async (key) => results[key],
    sourcePath: async (id) => (id === 'second' ? '/data/second' : undefined),
  }
}

describe('planPipeline', () => {
  it('applies Sharp steps to the Source', async () => {
    const blur = createSharpStep('blur', { sigma: 2 })
    const plan = await planPipeline(SOURCE, [blur], lookups())
    expect(plan.basePath).toBe(SOURCE.path)
    expect(plan.sharpSteps).toEqual([blur])
    expect(plan.applied).toEqual([blur])
    expect(plan.pending).toEqual([])
    expect(planKey(plan)).toBe(renderKey(SOURCE.contentHash, [blur]))
  })

  it('leaves out steps that are switched off', async () => {
    const off = { ...createSharpStep('flip'), enabled: false }
    const plan = await planPipeline(SOURCE, [off], lookups())
    expect(plan.applied).toEqual([])
  })

  it('skips a step that is not set up and says why', async () => {
    const resize = createSharpStep('extract')
    const flip = createSharpStep('flip')
    const plan = await planPipeline(SOURCE, [resize, flip], lookups())
    expect(plan.applied).toEqual([flip])
    expect(plan.skipped).toHaveLength(1)
    expect(plan.skipped[0]?.stepId).toBe(resize.id)
  })

  it('resolves a second image to its path', async () => {
    const step = createSharpStep('boolean', {
      operand: 'second',
      operator: 'and',
    })
    const plan = await planPipeline(SOURCE, [step], lookups())
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
    const plan = await planPipeline(SOURCE, [step], lookups())
    expect(plan.applied).toEqual([])
    expect(plan.skipped[0]?.message).toMatch(/no longer available/)
  })

  it('stops at an AI step with no Result and holds everything after it', async () => {
    const before = createSharpStep('flip')
    const ai = createAiStep(UPSCALE)
    const after = createSharpStep('flop')
    const later = createAiStep(UPSCALE)
    const steps: PipelineStep[] = [before, ai, after, later]
    const plan = await planPipeline(SOURCE, steps, lookups())
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
      SOURCE,
      [before, ai, after],
      lookups({ [key]: '/results/one' }),
    )
    expect(plan.basePath).toBe('/results/one')
    expect(plan.sharpSteps).toEqual([after])
    expect(plan.applied).toEqual([before, ai, after])
    expect(plan.pending).toEqual([])
  })
})
