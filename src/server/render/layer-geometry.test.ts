// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { layerPlacement, layerSize, visibleRegion } from './layer-geometry.ts'

const CANVAS = { width: 1000, height: 500 }

describe('layerSize', () => {
  it('keeps an image that fits as it is, with fit inside', () => {
    expect(
      layerSize(CANVAS, { width: 200, height: 100 }, 'inside', 100),
    ).toEqual({ width: 200, height: 100 })
  })

  it('shrinks an image that is too big to fit inside the canvas, keeping its proportions', () => {
    expect(
      layerSize(CANVAS, { width: 4000, height: 1000 }, 'inside', 100),
    ).toEqual({ width: 1000, height: 250 })
  })

  it('keeps the pixels of the image with fit original, even when it is bigger than the canvas', () => {
    expect(
      layerSize(CANVAS, { width: 4000, height: 1000 }, 'original', 100),
    ).toEqual({ width: 4000, height: 1000 })
  })

  it('enlarges a small image to fit inside the canvas with fit contain', () => {
    expect(
      layerSize(CANVAS, { width: 100, height: 100 }, 'contain', 100),
    ).toEqual({ width: 500, height: 500 })
  })

  it('fills the canvas with fit cover, keeping the proportions', () => {
    expect(
      layerSize(CANVAS, { width: 100, height: 100 }, 'cover', 100),
    ).toEqual({ width: 1000, height: 1000 })
  })

  it('takes the size of the canvas with fit stretch', () => {
    expect(
      layerSize(CANVAS, { width: 100, height: 300 }, 'stretch', 100),
    ).toEqual({ width: 1000, height: 500 })
  })

  it('applies the scale after the fit', () => {
    expect(
      layerSize(CANVAS, { width: 4000, height: 1000 }, 'inside', 50),
    ).toEqual({ width: 500, height: 125 })
    expect(
      layerSize(CANVAS, { width: 200, height: 100 }, 'original', 250),
    ).toEqual({ width: 500, height: 250 })
  })

  it('never makes an image smaller than one pixel', () => {
    expect(
      layerSize(CANVAS, { width: 10000, height: 10 }, 'inside', 1),
    ).toEqual({ width: 10, height: 1 })
  })
})

describe('layerPlacement', () => {
  const PLACED = { width: 200, height: 100 }

  it('puts the layer in the middle for the centre anchor', () => {
    expect(layerPlacement(CANVAS, PLACED, 'centre', 0, 0)).toEqual({
      left: 400,
      top: 200,
    })
  })

  it.each([
    ['northwest', { left: 0, top: 0 }],
    ['north', { left: 400, top: 0 }],
    ['northeast', { left: 800, top: 0 }],
    ['west', { left: 0, top: 200 }],
    ['east', { left: 800, top: 200 }],
    ['southwest', { left: 0, top: 400 }],
    ['south', { left: 400, top: 400 }],
    ['southeast', { left: 800, top: 400 }],
  ] as const)('puts the layer against the %s of the canvas', (anchor, at) => {
    expect(layerPlacement(CANVAS, PLACED, anchor, 0, 0)).toEqual(at)
  })

  it('moves the layer right and down by x and y, and left and up when they are negative', () => {
    expect(layerPlacement(CANVAS, PLACED, 'northwest', 30, 40)).toEqual({
      left: 30,
      top: 40,
    })
    expect(layerPlacement(CANVAS, PLACED, 'centre', -50, -20)).toEqual({
      left: 350,
      top: 180,
    })
  })

  it('rounds an odd leftover space down so a layer is always on whole pixels', () => {
    expect(
      layerPlacement(
        { width: 101, height: 101 },
        { width: 50, height: 50 },
        'centre',
        0,
        0,
      ),
    ).toEqual({ left: 25, top: 25 })
  })

  it('places a layer bigger than the canvas so that its middle is over the canvas middle', () => {
    expect(
      layerPlacement(CANVAS, { width: 1400, height: 700 }, 'centre', 0, 0),
    ).toEqual({ left: -200, top: -100 })
  })
})

describe('visibleRegion', () => {
  it('is the whole layer when it is inside the canvas', () => {
    expect(visibleRegion(CANVAS, { width: 200, height: 100 }, 10, 20)).toEqual({
      crop: { left: 0, top: 0, width: 200, height: 100 },
      at: { left: 10, top: 20 },
    })
  })

  it('cuts off what hangs over the top and left edges', () => {
    expect(
      visibleRegion(CANVAS, { width: 200, height: 100 }, -50, -30),
    ).toEqual({
      crop: { left: 50, top: 30, width: 150, height: 70 },
      at: { left: 0, top: 0 },
    })
  })

  it('cuts off what hangs over the bottom and right edges', () => {
    expect(
      visibleRegion(CANVAS, { width: 200, height: 100 }, 900, 450),
    ).toEqual({
      crop: { left: 0, top: 0, width: 100, height: 50 },
      at: { left: 900, top: 450 },
    })
  })

  it('cuts a layer bigger than the canvas to the canvas', () => {
    expect(
      visibleRegion(CANVAS, { width: 1400, height: 700 }, -200, -100),
    ).toEqual({
      crop: { left: 200, top: 100, width: 1000, height: 500 },
      at: { left: 0, top: 0 },
    })
  })

  it('is nothing when the layer is wholly off the canvas', () => {
    expect(
      visibleRegion(CANVAS, { width: 200, height: 100 }, 1000, 0),
    ).toBeUndefined()
    expect(
      visibleRegion(CANVAS, { width: 200, height: 100 }, -200, 0),
    ).toBeUndefined()
    expect(
      visibleRegion(CANVAS, { width: 200, height: 100 }, 0, 500),
    ).toBeUndefined()
    expect(
      visibleRegion(CANVAS, { width: 200, height: 100 }, 0, -100),
    ).toBeUndefined()
  })
})
