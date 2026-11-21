import { describe, expect, it } from 'vitest'

import {
  centreOn,
  clampViewport,
  fitViewport,
  fitZoom,
  formatPercent,
  initialViewport,
  MAX_PERCENT,
  MIN_PERCENT,
  panBy,
  parsePercent,
  percentOf,
  positionForZoom,
  visibleRect,
  zoomBy,
  zoomForPercent,
  zoomForPosition,
  zoomLimits,
  zoomToPercent,
} from '@/features/viewport/viewport'
import type { ViewFrame, Viewport } from '@/features/viewport/viewport'

/** A 2000 x 1000 picture in a 1000 x 800 window: it fits at 50%. */
const WIDE: ViewFrame = {
  viewWidth: 1000,
  viewHeight: 800,
  pictureWidth: 2000,
  pictureHeight: 1000,
}
/** A 400 x 400 picture in a 1000 x 800 window: it fits at 200%. */
const SMALL: ViewFrame = {
  viewWidth: 1000,
  viewHeight: 800,
  pictureWidth: 400,
  pictureHeight: 400,
}
/** WIDE fitted to its window. */
const WIDE_FIT: Viewport = { zoom: 0.5, x: 0.5, y: 0.5 }

describe('the zoom is a share of the picture’s own pixels', () => {
  it('is 100% when one picture pixel is one screen pixel', () => {
    expect(percentOf(1)).toBe(100)
    expect(percentOf(0.5)).toBe(50)
    expect(zoomForPercent(400)).toBe(4)
  })

  it('fits the picture inside the window', () => {
    expect(fitZoom(WIDE)).toBe(0.5)
    expect(fitZoom(SMALL)).toBe(2)
    expect(fitViewport(WIDE)).toEqual(WIDE_FIT)
  })

  it('opens a picture bigger than the window fitted, and a smaller one at actual size', () => {
    expect(initialViewport(WIDE)).toEqual(WIDE_FIT)
    expect(initialViewport(SMALL)).toEqual({ zoom: 1, x: 0.5, y: 0.5 })
  })

  it('goes out as far as the least percent and in as far as the most', () => {
    const { min, max } = zoomLimits(WIDE)
    expect(min).toBeCloseTo(MIN_PERCENT / 100, 10)
    expect(max).toBe(MAX_PERCENT / 100)
  })

  it('always has fit within its limits, even when fit is past the least or the most', () => {
    const tiny: ViewFrame = { ...SMALL, pictureWidth: 1, pictureHeight: 1 }
    expect(zoomLimits(tiny).max).toBe(fitZoom(tiny))
    const vast: ViewFrame = { ...SMALL, pictureWidth: 1e6, pictureHeight: 1e6 }
    expect(zoomLimits(vast).min).toBe(fitZoom(vast))
  })
})

describe('the part of the picture in the window', () => {
  it('is all of the picture at fit, when the window has the same shape', () => {
    const frame: ViewFrame = { ...WIDE, viewHeight: 500 }
    expect(visibleRect(WIDE_FIT, frame)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    })
  })

  it('is more than the picture where the window has room to spare', () => {
    const rect = visibleRect(WIDE_FIT, WIDE)
    expect(rect.x).toBe(0)
    expect(rect.y).toBeCloseTo(-0.3, 10)
    expect(rect.width).toBe(1)
    expect(rect.height).toBeCloseTo(1.6, 10)
  })

  it('shrinks as the zoom goes up', () => {
    const rect = visibleRect({ zoom: 2, x: 0.25, y: 0.5 }, WIDE)
    expect(rect.width).toBe(0.25)
    expect(rect.x).toBe(0.125)
    expect(rect.height).toBe(0.4)
  })
})

describe('keeping the picture in view', () => {
  it('keeps the window over the picture', () => {
    const clamped = clampViewport({ zoom: 2, x: -2, y: 9 }, WIDE)
    expect(clamped).toEqual({ zoom: 2, x: 0.125, y: 0.8 })
  })

  it('centres the picture on a side where all of it fits in the window', () => {
    expect(clampViewport({ zoom: 0.5, x: 0.9, y: 0.1 }, WIDE)).toEqual(WIDE_FIT)
  })

  it('keeps the zoom within its limits', () => {
    expect(
      clampViewport({ zoom: 0.0001, x: 0.5, y: 0.5 }, WIDE).zoom,
    ).toBeCloseTo(0.01, 10)
    expect(clampViewport({ zoom: 1e9, x: 0.5, y: 0.5 }, WIDE).zoom).toBe(32)
  })

  it('keeps its zoom when the picture changes size, so a smaller picture looks smaller', () => {
    const half: ViewFrame = { ...WIDE, pictureWidth: 1000, pictureHeight: 500 }
    expect(clampViewport(WIDE_FIT, half).zoom).toBe(0.5)
  })
})

describe('zooming', () => {
  it('zooms about the middle of the window by default', () => {
    expect(zoomBy(WIDE_FIT, WIDE, 2)).toEqual({ zoom: 1, x: 0.5, y: 0.5 })
  })

  it('keeps the point under the pointer where it is', () => {
    // The pointer is on the picture's left edge: x 0 of the picture is at 0 px.
    const zoomed = zoomBy(WIDE_FIT, WIDE, 4, { x: 0, y: 400 })
    const rect = visibleRect(zoomed, WIDE)
    expect(rect.x).toBeCloseTo(0, 10)
    expect(zoomed.zoom).toBe(2)
    // A quarter of the way across the window is still a quarter of the way across the view rect.
    const again = zoomBy(zoomed, WIDE, 2, { x: 250, y: 400 })
    const before = visibleRect(zoomed, WIDE)
    const after = visibleRect(again, WIDE)
    expect(before.x + before.width * 0.25).toBeCloseTo(
      after.x + after.width * 0.25,
      10,
    )
  })

  it('stops at the limits', () => {
    expect(zoomBy(WIDE_FIT, WIDE, 1e9).zoom).toBe(32)
    expect(zoomBy(WIDE_FIT, WIDE, 1e-9).zoom).toBeCloseTo(0.01, 10)
  })

  it('zooms to a percentage of the picture’s own pixels', () => {
    expect(zoomToPercent(WIDE_FIT, WIDE, 100).zoom).toBe(1)
    expect(zoomToPercent(WIDE_FIT, WIDE, 400).zoom).toBe(4)
  })

  it('goes below fit, to see the picture small', () => {
    expect(zoomToPercent(WIDE_FIT, WIDE, 20).zoom).toBeCloseTo(0.2, 10)
    expect(zoomToPercent(WIDE_FIT, WIDE, 20).x).toBe(0.5)
  })

  it('does not go below the least when asked for less', () => {
    expect(zoomToPercent(WIDE_FIT, WIDE, 0.1).zoom).toBeCloseTo(0.01, 10)
  })
})

describe('moving', () => {
  const zoomed = { zoom: 2, x: 0.5, y: 0.5 }

  it('pans the picture with the pointer, so dragging right shows what was to the left', () => {
    const moved = panBy(zoomed, WIDE, 100, 0)
    expect(moved.x).toBeCloseTo(0.5 - 100 / 4000, 10)
    expect(moved.y).toBe(0.5)
  })

  it('cannot pan the picture out of the window', () => {
    expect(panBy(zoomed, WIDE, 1e6, 1e6)).toEqual({
      zoom: 2,
      x: 0.125,
      y: 0.2,
    })
  })

  it('does not move a picture that fits', () => {
    expect(panBy(WIDE_FIT, WIDE, 50, 50)).toEqual(WIDE_FIT)
  })

  it('centres on a point of the picture', () => {
    expect(centreOn(zoomed, WIDE, { x: 0.3, y: 0.6 })).toEqual({
      zoom: 2,
      x: 0.3,
      y: 0.6,
    })
  })

  it('keeps a centre the picture cannot reach within the picture', () => {
    expect(centreOn(zoomed, WIDE, { x: 0, y: 1 })).toEqual({
      zoom: 2,
      x: 0.125,
      y: 0.8,
    })
  })
})

describe('the slider', () => {
  const limits = { min: 1, max: 64 }

  it('runs from the least at the left to the most at the right', () => {
    expect(zoomForPosition(0, limits)).toBe(1)
    expect(zoomForPosition(1, limits)).toBeCloseTo(64, 10)
  })

  it('moves by the same ratio over the same stretch', () => {
    expect(zoomForPosition(0.5, limits)).toBeCloseTo(8, 10)
  })

  it('is the inverse of the zoom', () => {
    for (const zoom of [1, 2, 7, 33, 64]) {
      expect(
        zoomForPosition(positionForZoom(zoom, limits), limits),
      ).toBeCloseTo(zoom, 8)
    }
  })

  it('stays at the left when there is nowhere to zoom to', () => {
    expect(positionForZoom(1, { min: 1, max: 1 })).toBe(0)
  })
})

describe('the percentage field', () => {
  it('reads a number with or without a percent sign', () => {
    expect(parsePercent('50')).toBe(50)
    expect(parsePercent(' 50% ')).toBe(50)
    expect(parsePercent('12.5 %')).toBe(12.5)
  })

  it('rejects anything else', () => {
    for (const text of ['', 'abc', '-5', '0', '5%%', '1e3']) {
      expect(parsePercent(text)).toBeUndefined()
    }
  })

  it('shows whole percentages of at least 1', () => {
    expect(formatPercent(49.6)).toBe('50%')
    expect(formatPercent(0.2)).toBe('1%')
  })
})
