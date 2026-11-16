import { describe, expect, it } from 'vitest'

import {
  centreOn,
  clampViewport,
  FIT_VIEWPORT,
  fitScale,
  fitSize,
  formatPercent,
  MAX_PERCENT,
  MIN_PERCENT,
  panBy,
  parsePercent,
  percentOf,
  positionForZoom,
  visibleRect,
  zoomBy,
  zoomForPosition,
  zoomLimits,
  zoomToPercent,
} from '@/features/viewport/viewport'
import type { ViewFrame } from '@/features/viewport/viewport'

/** A 2000 x 1000 picture in a 1000 x 800 window: fitted it is 1000 x 500, or 50%. */
const WIDE: ViewFrame = {
  viewWidth: 1000,
  viewHeight: 800,
  ratio: 2,
  naturalWidth: 2000,
}
/** A 400 x 400 picture in a 1000 x 800 window: fitted it is 800 x 800, or 200%. */
const SMALL: ViewFrame = {
  viewWidth: 1000,
  viewHeight: 800,
  ratio: 1,
  naturalWidth: 400,
}

describe('fitting', () => {
  it('fits the picture inside the window', () => {
    expect(fitSize(WIDE)).toEqual({ width: 1000, height: 500 })
    expect(fitSize(SMALL)).toEqual({ width: 800, height: 800 })
  })

  it('says how big the fitted picture is, as a percentage of its own pixels', () => {
    expect(fitScale(WIDE)).toBe(0.5)
    expect(percentOf(1, WIDE)).toBe(50)
    expect(percentOf(4, WIDE)).toBe(200)
    expect(percentOf(1, SMALL)).toBe(200)
  })

  it('goes out as far as the least percent and in as far as the most', () => {
    const { min, max } = zoomLimits(WIDE)
    expect(min).toBeCloseTo(MIN_PERCENT / 50, 10)
    expect(max).toBe(MAX_PERCENT / 50)
  })

  it('always has fit within its limits, even when fit is past the least or the most', () => {
    const huge: ViewFrame = { ...SMALL, naturalWidth: 1 }
    expect(zoomLimits(huge).max).toBe(1)
    expect(zoomLimits(huge).min).toBeLessThan(1)
    const vast: ViewFrame = { ...SMALL, naturalWidth: 1e6 }
    expect(zoomLimits(vast).min).toBe(1)
  })
})

describe('the part of the picture in the window', () => {
  it('is all of the picture at fit, when the window has the same shape', () => {
    const frame: ViewFrame = { ...WIDE, viewHeight: 500 }
    expect(visibleRect(FIT_VIEWPORT, frame)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    })
  })

  it('is more than the picture where the window has room to spare', () => {
    const rect = visibleRect(FIT_VIEWPORT, WIDE)
    expect(rect.x).toBe(0)
    expect(rect.y).toBeCloseTo(-0.3, 10)
    expect(rect.width).toBe(1)
    expect(rect.height).toBeCloseTo(1.6, 10)
  })

  it('shrinks as the zoom goes up', () => {
    const rect = visibleRect({ zoom: 4, x: 0.25, y: 0.5 }, WIDE)
    expect(rect.width).toBe(0.25)
    expect(rect.x).toBe(0.125)
    expect(rect.height).toBe(0.4)
  })
})

describe('keeping the picture in view', () => {
  it('keeps the window over the picture', () => {
    const clamped = clampViewport({ zoom: 4, x: -2, y: 9 }, WIDE)
    expect(clamped).toEqual({ zoom: 4, x: 0.125, y: 0.8 })
  })

  it('centres the picture on a side where all of it fits in the window', () => {
    expect(clampViewport({ zoom: 1, x: 0.9, y: 0.1 }, WIDE)).toEqual(
      FIT_VIEWPORT,
    )
  })

  it('keeps the zoom within its limits', () => {
    expect(
      clampViewport({ zoom: 0.001, x: 0.5, y: 0.5 }, WIDE).zoom,
    ).toBeCloseTo(0.02, 10)
    expect(clampViewport({ zoom: 1e9, x: 0.5, y: 0.5 }, WIDE).zoom).toBe(64)
  })
})

describe('zooming', () => {
  it('zooms about the middle of the window by default', () => {
    expect(zoomBy(FIT_VIEWPORT, WIDE, 2)).toEqual({ zoom: 2, x: 0.5, y: 0.5 })
  })

  it('keeps the point under the pointer where it is', () => {
    // The pointer is on the picture's left edge: x 0 of the picture is at 0 px.
    const zoomed = zoomBy(FIT_VIEWPORT, WIDE, 4, { x: 0, y: 400 })
    const rect = visibleRect(zoomed, WIDE)
    expect(rect.x).toBeCloseTo(0, 10)
    expect(zoomed.zoom).toBe(4)
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
    expect(zoomBy(FIT_VIEWPORT, WIDE, 1e9).zoom).toBe(64)
    expect(zoomBy(FIT_VIEWPORT, WIDE, 1e-9).zoom).toBeCloseTo(0.02, 10)
  })

  it('zooms to a percentage of the picture’s own pixels', () => {
    expect(zoomToPercent(FIT_VIEWPORT, WIDE, 100).zoom).toBe(2)
    expect(zoomToPercent(FIT_VIEWPORT, WIDE, 400).zoom).toBe(8)
  })

  it('goes below fit, to see the picture small', () => {
    expect(zoomToPercent(FIT_VIEWPORT, WIDE, 20).zoom).toBeCloseTo(0.4, 10)
    expect(zoomToPercent(FIT_VIEWPORT, WIDE, 20).x).toBe(0.5)
  })

  it('does not go below the least when asked for less', () => {
    expect(zoomToPercent(FIT_VIEWPORT, WIDE, 0.1).zoom).toBeCloseTo(0.02, 10)
  })
})

describe('moving', () => {
  const zoomed = { zoom: 4, x: 0.5, y: 0.5 }

  it('pans the picture with the pointer, so dragging right shows what was to the left', () => {
    const moved = panBy(zoomed, WIDE, 100, 0)
    expect(moved.x).toBeCloseTo(0.5 - 100 / 4000, 10)
    expect(moved.y).toBe(0.5)
  })

  it('cannot pan the picture out of the window', () => {
    expect(panBy(zoomed, WIDE, 1e6, 1e6)).toEqual({
      zoom: 4,
      x: 0.125,
      y: 0.2,
    })
  })

  it('does not move a picture that fits', () => {
    expect(panBy(FIT_VIEWPORT, WIDE, 50, 50)).toEqual(FIT_VIEWPORT)
  })

  it('centres on a point of the picture', () => {
    expect(centreOn(zoomed, WIDE, { x: 0.3, y: 0.6 })).toEqual({
      zoom: 4,
      x: 0.3,
      y: 0.6,
    })
  })

  it('keeps a centre the picture cannot reach within the picture', () => {
    expect(centreOn(zoomed, WIDE, { x: 0, y: 1 })).toEqual({
      zoom: 4,
      x: 0.125,
      y: 0.8,
    })
  })
})

describe('the slider', () => {
  const limits = { min: 1, max: 64 }

  it('runs from fit at the left to the most at the right', () => {
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
