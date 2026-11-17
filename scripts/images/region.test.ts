import { describe, expect, it } from 'vitest'

import { ValidationError } from '../../src/server/errors.ts'
import { cropBox, parseRegion } from './region.ts'

describe('parseRegion', () => {
  it('reads x, y, width and height as fractions of the picture', () => {
    expect(parseRegion('0.25,0.5,0.5,0.25')).toEqual({
      x: 0.25,
      y: 0.5,
      width: 0.5,
      height: 0.25,
    })
  })

  it('allows spaces and the whole picture', () => {
    expect(parseRegion(' 0 , 0 , 1 , 1 ')).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    })
  })

  it.each([
    ['', 'four numbers'],
    ['0,0,1', 'four numbers'],
    ['0,0,1,1,1', 'four numbers'],
    ['a,0,1,1', 'numbers'],
    ['-0.1,0,0.5,0.5', 'inside the picture'],
    ['0,0,0,0.5', 'inside the picture'],
    ['0.6,0,0.5,0.5', 'inside the picture'],
    ['0,0.6,0.5,0.5', 'inside the picture'],
    ['0,0,1.5,1', 'inside the picture'],
  ])('refuses %j', (text, why) => {
    expect(() => parseRegion(text)).toThrow(ValidationError)
    expect(() => parseRegion(text)).toThrow(why)
  })
})

describe('cropBox', () => {
  it('turns a region into whole pixels of a picture', () => {
    expect(
      cropBox({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }, 400, 200),
    ).toEqual({ left: 100, top: 100, width: 200, height: 50 })
  })

  it('takes every pixel the region touches', () => {
    expect(
      cropBox({ x: 0.1, y: 0.1, width: 0.3, height: 0.3 }, 10, 10),
    ).toEqual({ left: 1, top: 1, width: 3, height: 3 })
  })

  it('stays inside the picture and is at least one pixel', () => {
    expect(
      cropBox({ x: 0.999, y: 0.999, width: 0.001, height: 0.001 }, 8, 6),
    ).toEqual({ left: 7, top: 5, width: 1, height: 1 })
    expect(cropBox({ x: 0, y: 0, width: 1, height: 1 }, 8, 6)).toEqual({
      left: 0,
      top: 0,
      width: 8,
      height: 6,
    })
  })
})
