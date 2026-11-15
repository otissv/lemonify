import { describe, expect, it } from 'vitest'

import { hsvToRgb, rgbToHsv } from '@/features/workflows/fields/colour-model'

describe('rgbToHsv', () => {
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
  ])('converts %j', (rgb, hsv) => {
    expect(rgbToHsv(rgb)).toEqual(hsv)
  })
})

describe('hsvToRgb', () => {
  it('is the inverse of rgbToHsv for whole colours', () => {
    for (const rgb of [
      { r: 242, g: 241, b: 241 },
      { r: 12, g: 200, b: 99 },
      { r: 255, g: 128, b: 0 },
    ])
      expect(hsvToRgb(rgbToHsv(rgb))).toEqual(rgb)
  })

  it('wraps a hue of 360 to red', () => {
    expect(hsvToRgb({ h: 360, s: 1, v: 1 })).toEqual({ r: 255, g: 0, b: 0 })
  })
})
