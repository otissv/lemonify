import { describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { createAiStep, createSharpStep } from '@/features/pipeline/pipeline'

import { renderKey } from './render-key.ts'

const HASH = 'a'.repeat(64)
const UPSCALE = {
  tool: AiToolId.Upscale,
  settings: { model: 'm', scale: 4, iterations: 1, tta: false },
} as const

describe('renderKey', () => {
  it('is the same for the same Source and steps', () => {
    const step = createSharpStep('blur', { sigma: 3 })
    expect(renderKey(HASH, [step])).toBe(renderKey(HASH, [step]))
    expect(renderKey(HASH, [step])).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ignores step ids, option order and whether a step is on', () => {
    const a = createSharpStep('resize', { width: 10, height: 20 })
    const b = {
      ...createSharpStep('resize', { height: 20, width: 10 }),
      enabled: false,
    }
    expect(renderKey(HASH, [a])).toBe(renderKey(HASH, [b]))
  })

  it('changes with the Source, the options, the order and the steps', () => {
    const blur = createSharpStep('blur', { sigma: 3 })
    const sharper = createSharpStep('blur', { sigma: 4 })
    const flip = createSharpStep('flip')
    const keys = new Set([
      renderKey(HASH, [blur]),
      renderKey('b'.repeat(64), [blur]),
      renderKey(HASH, [sharper]),
      renderKey(HASH, [blur, flip]),
      renderKey(HASH, [flip, blur]),
      renderKey(HASH, []),
    ])
    expect(keys.size).toBe(6)
  })

  it('tells AI tools and their settings apart', () => {
    const base = createAiStep(UPSCALE)
    const bigger = createAiStep({
      tool: AiToolId.Upscale,
      settings: { ...UPSCALE.settings, scale: 2 },
    })
    expect(renderKey(HASH, [base])).not.toBe(renderKey(HASH, [bigger]))
  })
})
