import { describe, expect, it } from 'vitest'

import {
  hsvToRgb,
  parseHexInput,
  rgbToHsv,
  toHexAlpha,
} from '@/features/workflows/fields/colour-math'

describe('rgbToHsv and hsvToRgb', () => {
  it.each([
    [
      { r: 255, g: 0, b: 0 },
      { h: 0, s: 1, v: 1 },
    ],
    [
      { r: 0, g: 255, b: 0 },
      { h: 120, s: 1, v: 1 },
    ],
    [
      { r: 0, g: 0, b: 255 },
      { h: 240, s: 1, v: 1 },
    ],
    [
      { r: 255, g: 255, b: 255 },
      { h: 0, s: 0, v: 1 },
    ],
    [
      { r: 0, g: 0, b: 0 },
      { h: 0, s: 0, v: 0 },
    ],
  ])('converts %o', (rgb, hsv) => {
    expect(rgbToHsv(rgb)).toEqual(hsv)
    expect(hsvToRgb(hsv)).toEqual(rgb)
  })

  it('round-trips any colour to within a rounding step', () => {
    const rgb = { r: 205, g: 45, b: 45 }

    expect(hsvToRgb(rgbToHsv(rgb))).toEqual(rgb)
  })

  it('keeps the hue it is given when the colour is grey', () => {
    expect(hsvToRgb({ h: 200, s: 0, v: 0.5 })).toEqual({
      r: 128,
      g: 128,
      b: 128,
    })
  })
})

describe('parseHexInput', () => {
  it.each([
    ['#ff8000', { r: 255, g: 128, b: 0, alpha: 1 }],
    ['ff8000', { r: 255, g: 128, b: 0, alpha: 1 }],
    ['#f80', { r: 255, g: 136, b: 0, alpha: 1 }],
    ['#ff800080', { r: 255, g: 128, b: 0, alpha: 128 / 255 }],
  ])('reads %s', (text, expected) => {
    expect(parseHexInput(text)).toEqual(expected)
  })

  it('refuses anything that is not hex', () => {
    expect(parseHexInput('red')).toBeUndefined()
    expect(parseHexInput('#12')).toBeUndefined()
    expect(parseHexInput('')).toBeUndefined()
  })
})

describe('toHexAlpha', () => {
  it('is six digits while opaque, eight once see-through', () => {
    expect(toHexAlpha({ r: 255, g: 128, b: 0, alpha: 1 })).toBe('#ff8000')
    expect(toHexAlpha({ r: 255, g: 128, b: 0, alpha: 0.5 })).toBe('#ff800080')
  })
})
