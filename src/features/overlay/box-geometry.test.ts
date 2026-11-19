import { describe, expect, it } from 'vitest'

import { clampBox, dragBox, nudgeBox } from '@/features/overlay/box-geometry'
import type { Box } from '@/features/overlay/box-geometry'

const BOUNDS = { width: 1000, height: 500 }
const START: Box = { left: 100, top: 100, width: 200, height: 100 }
const PLAIN = { keepAspect: false, fromCentre: false }

describe('dragBox: move', () => {
  it('moves the box and keeps its size', () => {
    expect(dragBox(START, 'move', { x: 30, y: -20 }, BOUNDS, PLAIN)).toEqual({
      left: 130,
      top: 80,
      width: 200,
      height: 100,
    })
  })

  it('stops at every edge of the picture without shrinking', () => {
    expect(dragBox(START, 'move', { x: -500, y: -500 }, BOUNDS, PLAIN)).toEqual(
      { left: 0, top: 0, width: 200, height: 100 },
    )
    expect(dragBox(START, 'move', { x: 5000, y: 5000 }, BOUNDS, PLAIN)).toEqual(
      { left: 800, top: 400, width: 200, height: 100 },
    )
  })

  it('rounds to whole pixels', () => {
    const moved = dragBox(START, 'move', { x: 10.4, y: 10.6 }, BOUNDS, PLAIN)
    expect(moved.left).toBe(110)
    expect(moved.top).toBe(111)
  })
})

describe('dragBox: edges and corners', () => {
  it('moves the east edge and keeps the west one', () => {
    expect(dragBox(START, 'e', { x: 50, y: 99 }, BOUNDS, PLAIN)).toEqual({
      left: 100,
      top: 100,
      width: 250,
      height: 100,
    })
  })

  it('moves the west edge and keeps the east one', () => {
    expect(dragBox(START, 'w', { x: -40, y: 0 }, BOUNDS, PLAIN)).toEqual({
      left: 60,
      top: 100,
      width: 240,
      height: 100,
    })
  })

  it('moves the north and south edges', () => {
    expect(dragBox(START, 'n', { x: 0, y: -50 }, BOUNDS, PLAIN)).toMatchObject({
      top: 50,
      height: 150,
    })
    expect(dragBox(START, 's', { x: 0, y: 25 }, BOUNDS, PLAIN)).toMatchObject({
      top: 100,
      height: 125,
    })
  })

  it('resizes freely from a corner', () => {
    expect(dragBox(START, 'se', { x: 30, y: -40 }, BOUNDS, PLAIN)).toEqual({
      left: 100,
      top: 100,
      width: 230,
      height: 60,
    })
    expect(dragBox(START, 'nw', { x: 20, y: 10 }, BOUNDS, PLAIN)).toEqual({
      left: 120,
      top: 110,
      width: 180,
      height: 90,
    })
  })

  it('stops at the edges of the picture', () => {
    expect(dragBox(START, 'se', { x: 5000, y: 5000 }, BOUNDS, PLAIN)).toEqual({
      left: 100,
      top: 100,
      width: 900,
      height: 400,
    })
    expect(dragBox(START, 'nw', { x: -5000, y: -5000 }, BOUNDS, PLAIN)).toEqual(
      { left: 0, top: 0, width: 300, height: 200 },
    )
  })

  it('never gets smaller than one pixel, and never flips over', () => {
    expect(
      dragBox(START, 'e', { x: -5000, y: 0 }, BOUNDS, PLAIN),
    ).toMatchObject({ left: 100, width: 1 })
    expect(dragBox(START, 'w', { x: 5000, y: 0 }, BOUNDS, PLAIN)).toMatchObject(
      {
        left: 299,
        width: 1,
      },
    )
    expect(dragBox(START, 'n', { x: 0, y: 5000 }, BOUNDS, PLAIN)).toMatchObject(
      {
        top: 199,
        height: 1,
      },
    )
  })

  it('rounds to whole pixels', () => {
    expect(
      dragBox(START, 'se', { x: 10.4, y: 10.6 }, BOUNDS, PLAIN),
    ).toMatchObject({ width: 210, height: 111 })
  })
})

describe('dragBox: keeping the aspect ratio', () => {
  const KEEP = { keepAspect: true, fromCentre: false }

  it('follows the bigger change from a corner', () => {
    expect(dragBox(START, 'se', { x: 40, y: 0 }, BOUNDS, KEEP)).toEqual({
      left: 100,
      top: 100,
      width: 240,
      height: 120,
    })
    expect(dragBox(START, 'se', { x: 0, y: 50 }, BOUNDS, KEEP)).toEqual({
      left: 100,
      top: 100,
      width: 300,
      height: 150,
    })
  })

  it('anchors the opposite corner', () => {
    expect(dragBox(START, 'nw', { x: -40, y: 0 }, BOUNDS, KEEP)).toEqual({
      left: 60,
      top: 80,
      width: 240,
      height: 120,
    })
  })

  it('changes the other side about the middle from an edge', () => {
    expect(dragBox(START, 'e', { x: 100, y: 0 }, BOUNDS, KEEP)).toEqual({
      left: 100,
      top: 75,
      width: 300,
      height: 150,
    })
  })

  it('shrinks both sides together when the picture stops one of them', () => {
    const grown = dragBox(START, 'se', { x: 5000, y: 0 }, BOUNDS, KEEP)
    expect(grown.height).toBeLessThanOrEqual(400)
    expect(grown.left + grown.width).toBeLessThanOrEqual(1000)
    expect(grown.top + grown.height).toBeLessThanOrEqual(500)
    expect(grown.width / grown.height).toBeCloseTo(2, 1)
  })
})

describe('dragBox: from the centre', () => {
  const CENTRE = { keepAspect: false, fromCentre: true }

  it('grows both sides by the same amount', () => {
    expect(dragBox(START, 'e', { x: 30, y: 0 }, BOUNDS, CENTRE)).toEqual({
      left: 70,
      top: 100,
      width: 260,
      height: 100,
    })
  })

  it('stops when the nearer edge of the picture is reached', () => {
    const grown = dragBox(START, 'e', { x: 5000, y: 0 }, BOUNDS, CENTRE)
    expect(grown.left).toBe(0)
    expect(grown.width).toBe(400)
  })

  it('keeps the middle in place for a corner', () => {
    expect(dragBox(START, 'se', { x: 10, y: 10 }, BOUNDS, CENTRE)).toEqual({
      left: 90,
      top: 90,
      width: 220,
      height: 120,
    })
  })
})

describe('nudgeBox', () => {
  it('moves by the given amount and stops at the edges', () => {
    expect(nudgeBox(START, 1, -1, BOUNDS)).toMatchObject({ left: 101, top: 99 })
    expect(nudgeBox(START, -500, -500, BOUNDS)).toMatchObject({
      left: 0,
      top: 0,
    })
    expect(nudgeBox(START, 5000, 5000, BOUNDS)).toMatchObject({
      left: 800,
      top: 400,
    })
  })
})

describe('clampBox', () => {
  it('leaves a box that is inside the picture as it is', () => {
    expect(clampBox(START, BOUNDS)).toEqual(START)
  })

  it('moves a box back in and cuts it to the picture when it is too big', () => {
    expect(
      clampBox({ left: 900, top: 450, width: 300, height: 300 }, BOUNDS),
    ).toEqual({ left: 900, top: 450, width: 100, height: 50 })
    expect(
      clampBox({ left: 0, top: 0, width: 5000, height: 5000 }, BOUNDS),
    ).toEqual({ left: 0, top: 0, width: 1000, height: 500 })
  })

  it('keeps one pixel of a box that is wholly outside, at the nearest edge', () => {
    expect(
      clampBox({ left: 2000, top: 2000, width: 10, height: 10 }, BOUNDS),
    ).toEqual({ left: 999, top: 499, width: 1, height: 1 })
  })

  it('makes whole pixels of at least one', () => {
    expect(
      clampBox({ left: 1.4, top: 2.6, width: 0, height: 10.4 }, BOUNDS),
    ).toEqual({ left: 1, top: 3, width: 1, height: 10 })
  })
})
