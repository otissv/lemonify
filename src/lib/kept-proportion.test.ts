import { describe, expect, it } from 'vitest'

import { PairSide, partnerOf, proportionOf } from '@/lib/kept-proportion'

describe('proportionOf', () => {
  it('is the second value over the first', () => {
    expect(proportionOf(800, 600)).toBe(0.75)
  })

  it('is unknown while either value is missing, zero or not a number', () => {
    expect(proportionOf(undefined, 600)).toBeUndefined()
    expect(proportionOf(800, 0)).toBeUndefined()
    expect(proportionOf('800', 600)).toBeUndefined()
  })
})

describe('partnerOf', () => {
  it('gives the second value for a new first one, and the first for a new second one', () => {
    expect(partnerOf(PairSide.First, 400, 0.75, { integers: true })).toBe(300)
    expect(partnerOf(PairSide.Second, 300, 0.75, { integers: true })).toBe(400)
  })

  it('rounds to whole numbers when asked, never below one', () => {
    expect(partnerOf(PairSide.First, 3, 0.75, { integers: true })).toBe(2)
    expect(partnerOf(PairSide.First, 1, 0.1, { integers: true })).toBe(1)
    expect(partnerOf(PairSide.First, 3, 0.75, { integers: false })).toBe(2.25)
  })
})
