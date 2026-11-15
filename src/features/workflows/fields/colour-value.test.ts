import { describe, expect, it } from 'vitest'

import {
  formatColour,
  formatHex,
  parseColour,
  toHex,
} from '@/features/workflows/fields/colour-value'

describe('parseColour', () => {
  it.each([
    ['#ff0000', { r: 255, g: 0, b: 0, alpha: 1 }],
    ['#F00', { r: 255, g: 0, b: 0, alpha: 1 }],
    ['#00ff0080', { r: 0, g: 255, b: 0, alpha: 128 / 255 }],
    ['#0f08', { r: 0, g: 255, b: 0, alpha: 136 / 255 }],
  ])('reads the hex colour %s', (text, expected) => {
    expect(parseColour(text)).toEqual(expected)
  })

  it('reads an {r, g, b, alpha} colour, with alpha 1 when it has none', () => {
    expect(parseColour({ r: 1, g: 2, b: 3, alpha: 0.5 })).toEqual({
      r: 1,
      g: 2,
      b: 3,
      alpha: 0.5,
    })
    expect(parseColour({ r: 1, g: 2, b: 3 })).toEqual({
      r: 1,
      g: 2,
      b: 3,
      alpha: 1,
    })
  })

  it('cannot read a colour name or anything else', () => {
    expect(parseColour('red')).toBeUndefined()
    expect(parseColour('#12')).toBeUndefined()
    expect(parseColour(undefined)).toBeUndefined()
    expect(parseColour(5)).toBeUndefined()
    expect(parseColour({ r: 1 })).toBeUndefined()
  })
})

describe('formatColour', () => {
  it('writes an opaque colour as a six-digit hex string', () => {
    expect(formatColour({ r: 255, g: 0, b: 16, alpha: 1 })).toBe('#ff0010')
  })

  it('writes a see-through colour as {r, g, b, alpha}', () => {
    expect(formatColour({ r: 255, g: 0, b: 16, alpha: 0.25 })).toEqual({
      r: 255,
      g: 0,
      b: 16,
      alpha: 0.25,
    })
  })
})

describe('toHex', () => {
  it('is the colour without its opacity, as a colour input wants it', () => {
    expect(toHex({ r: 0, g: 128, b: 255, alpha: 0.2 })).toBe('#0080ff')
  })
})

describe('formatHex', () => {
  it('adds the opacity as two more digits only when see-through', () => {
    expect(formatHex({ r: 255, g: 0, b: 0, alpha: 1 })).toBe('#ff0000')
    expect(formatHex({ r: 255, g: 0, b: 0, alpha: 0.25 })).toBe('#ff000040')
  })
})
