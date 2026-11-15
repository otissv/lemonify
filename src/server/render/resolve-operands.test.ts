import { describe, expect, it } from 'vitest'

import { createSharpStep } from '@/features/pipeline/pipeline'

import { resolveOperands } from './resolve-operands.ts'

const PATHS = new Map([
  ['s1', '/data/s1'],
  ['s2', '/data/s2'],
])
const lookup = async (id: string): Promise<string | undefined> => PATHS.get(id)

describe('resolveOperands', () => {
  it('leaves a step with no second image alone', async () => {
    const step = createSharpStep('blur', { sigma: 2 })
    expect(await resolveOperands(step, lookup)).toEqual({ step })
  })

  it('replaces a boolean operand', async () => {
    const step = createSharpStep('boolean', { operand: 's1', operator: 'and' })
    const { step: resolved } = await resolveOperands(step, lookup)
    expect(resolved?.options).toEqual({ operand: '/data/s1', operator: 'and' })
  })

  it('replaces joined channels, one or several', async () => {
    const one = createSharpStep('joinChannel', { images: 's1' })
    const many = createSharpStep('joinChannel', { images: ['s1', 's2'] })
    expect((await resolveOperands(one, lookup)).step?.options).toEqual({
      images: '/data/s1',
    })
    expect((await resolveOperands(many, lookup)).step?.options).toEqual({
      images: ['/data/s1', '/data/s2'],
    })
  })

  it('replaces composite layer inputs and keeps their other fields', async () => {
    const step = createSharpStep('composite', {
      images: [{ input: 's2', blend: 'over', top: 4 }],
    })
    const { step: resolved } = await resolveOperands(step, lookup)
    expect(resolved?.options).toEqual({
      images: [{ input: '/data/s2', blend: 'over', top: 4 }],
    })
  })

  it('reports a second image that no longer exists', async () => {
    const step = createSharpStep('boolean', {
      operand: 'gone',
      operator: 'and',
    })
    const result = await resolveOperands(step, lookup)
    expect(result.problem).toMatch(/no longer available/)
    expect(result.step).toBeUndefined()
  })
})
