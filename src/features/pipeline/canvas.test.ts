import { describe, expect, it } from 'vitest'

import {
  MAX_CANVAS_PIXELS,
  MAX_CANVAS_SIDE,
  canvasIdentity,
  canvasOfSize,
  canvasSchema,
  parseBackground,
} from '@/features/pipeline/canvas'

describe('canvasSchema', () => {
  it('accepts a size and a background, and writes the background in lower case', () => {
    expect(
      canvasSchema.parse({ width: 800, height: 600, background: '#FFAA00' }),
    ).toEqual({ width: 800, height: 600, background: '#ffaa00' })
  })

  it('has a transparent background unless one is given', () => {
    expect(canvasSchema.parse({ width: 1, height: 1 }).background).toBe(
      'transparent',
    )
  })

  it.each([
    ['a zero side', { width: 0, height: 10 }],
    ['a fractional side', { width: 1.5, height: 10 }],
    ['a negative side', { width: 10, height: -1 }],
    ['a side that is too long', { width: MAX_CANVAS_SIDE + 1, height: 1 }],
    [
      'too many pixels',
      { width: MAX_CANVAS_SIDE, height: MAX_CANVAS_PIXELS / 1000 },
    ],
    [
      'a background that is not a colour',
      { width: 1, height: 1, background: 'red' },
    ],
    ['a short hex colour', { width: 1, height: 1, background: '#fff' }],
    ['an unknown field', { width: 1, height: 1, dpi: 72 }],
    ['text', 'big'],
  ])('refuses %s', (_name, input) => {
    expect(canvasSchema.safeParse(input).success).toBe(false)
  })
})

describe('the canvas helpers', () => {
  it('makes a transparent canvas of a size', () => {
    expect(canvasOfSize(640, 480)).toEqual({
      width: 640,
      height: 480,
      background: 'transparent',
    })
    expect(() => canvasOfSize(0, 5)).toThrow()
  })

  it('names a canvas by what it holds, for render keys', () => {
    expect(canvasIdentity(canvasOfSize(2, 3))).toBe('canvas:2x3:transparent')
    expect(canvasIdentity({ width: 2, height: 3, background: '#000000' })).toBe(
      'canvas:2x3:#000000',
    )
  })

  it('reads a background as colour values for the engine', () => {
    expect(parseBackground('transparent')).toEqual({
      r: 0,
      g: 0,
      b: 0,
      alpha: 0,
    })
    expect(parseBackground('#ff8000')).toEqual({
      r: 255,
      g: 128,
      b: 0,
      alpha: 1,
    })
  })
})
