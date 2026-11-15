import { describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'

import { FakeAiEngine } from '../testing/fakes.ts'
import { AiToolRegistry, upscaleEntry } from './ai-tool-registry.ts'

const SETTINGS = { model: 'm', scale: 4, iterations: 1, tta: false }

describe('AiToolRegistry', () => {
  const registry = new AiToolRegistry([upscaleEntry(new FakeAiEngine())])

  it('lists the tools it knows', () => {
    expect(registry.list().map(({ id }) => id)).toEqual([AiToolId.Upscale])
  })

  it('refuses a tool it does not have', () => {
    const empty = new AiToolRegistry([])
    expect(() => empty.get(AiToolId.Upscale)).toThrow(/not available/)
  })

  it('batches images with equal settings, however the keys were written', () => {
    const { batchKey } = registry.get(AiToolId.Upscale)
    const reordered = {
      tta: false,
      iterations: 1,
      scale: 4,
      model: 'm',
    }
    expect(batchKey(SETTINGS)).toBe(batchKey(reordered))
    expect(batchKey({ ...SETTINGS, scale: 2 })).not.toBe(batchKey(SETTINGS))
    expect(batchKey({ ...SETTINGS, model: 'other' })).not.toBe(
      batchKey(SETTINGS),
    )
  })
})
