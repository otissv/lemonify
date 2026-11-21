import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useViewport } from '@/features/viewport/use-viewport'
import type { ViewFrame } from '@/features/viewport/viewport'
import { useUiStore } from '@/store/ui-store'
import { resetStores } from '@/store/reset-stores'
import { forgetItem } from '@/store/forget-item'

const ID = 'doc'
/** A 2000 x 1000 picture in a 1000 x 800 window: it fits at 50%. */
const FRAME: ViewFrame = {
  viewWidth: 1000,
  viewHeight: 800,
  pictureWidth: 2000,
  pictureHeight: 1000,
}

function measured(): void {
  useUiStore.getState().setViewFrame(ID, FRAME)
}

function view() {
  return renderHook(() => useViewport(ID))
}

beforeEach(() => {
  resetStores()
})

describe('useViewport', () => {
  it('shows the whole picture until the canvas has been measured', () => {
    const { result } = view()

    expect(result.current.viewport).toEqual({ zoom: 1, x: 0.5, y: 0.5 })
    expect(result.current.percent).toBeUndefined()
    expect(result.current.limits).toBeUndefined()
  })

  it('ignores changes until the canvas has been measured', () => {
    const { result } = view()

    act(() => {
      result.current.zoomIn()
    })

    expect(useUiStore.getState().viewports[ID]).toBeUndefined()
  })

  it('says the zoom as a percentage of the picture’s own pixels, and how far it can go', () => {
    measured()
    const { result } = view()

    expect(result.current.percent).toBe(50)
    expect(result.current.limits?.min).toBeCloseTo(0.01, 10)
    expect(result.current.limits?.max).toBe(32)
  })

  it('opens at the zoom the picture first fits at, and keeps it', () => {
    measured()

    expect(useUiStore.getState().viewports[ID]).toEqual({
      zoom: 0.5,
      x: 0.5,
      y: 0.5,
    })
  })

  it('opens a picture smaller than the window at actual size', () => {
    useUiStore
      .getState()
      .setViewFrame(ID, { ...FRAME, pictureWidth: 400, pictureHeight: 200 })
    const { result } = view()

    expect(result.current.percent).toBe(100)
  })

  it('keeps the zoom when the picture changes size, so a smaller picture looks smaller', () => {
    measured()
    const { result } = view()

    act(() => {
      useUiStore
        .getState()
        .setViewFrame(ID, { ...FRAME, pictureWidth: 500, pictureHeight: 250 })
    })

    expect(result.current.percent).toBe(50)
  })

  it('zooms in and out by a step, and back to fit', () => {
    measured()
    const { result } = view()

    act(() => {
      result.current.zoomIn()
    })
    expect(result.current.viewport.zoom).toBe(0.625)
    act(() => {
      result.current.zoomOut()
      result.current.zoomOut()
    })
    expect(result.current.viewport.zoom).toBeCloseTo(0.4, 10)
    act(() => {
      result.current.zoomToPercent(400)
      result.current.fit()
    })
    expect(result.current.viewport).toEqual({ zoom: 0.5, x: 0.5, y: 0.5 })
  })

  it('zooms to a percentage and to actual size', () => {
    measured()
    const { result } = view()

    act(() => {
      result.current.zoomToPercent(200)
    })
    expect(result.current.percent).toBe(200)
    act(() => {
      result.current.actualSize()
    })
    expect(result.current.percent).toBe(100)
  })

  it('swaps between actual size and fit', () => {
    measured()
    const { result } = view()

    act(() => {
      result.current.toggleActualSize()
    })
    expect(result.current.percent).toBe(100)
    act(() => {
      result.current.toggleActualSize()
    })
    expect(result.current.viewport.zoom).toBe(0.5)
  })

  it('zooms to where the slider is', () => {
    measured()
    const { result } = view()

    act(() => {
      result.current.zoomToPosition(0.5)
    })
    expect(result.current.viewport.zoom).toBeCloseTo(Math.sqrt(0.01 * 32), 8)
    act(() => {
      result.current.zoomToPosition(0)
    })
    expect(result.current.viewport.zoom).toBeCloseTo(0.01, 8)
  })

  it('pans and centres, staying over the picture', () => {
    measured()
    const { result } = view()
    act(() => {
      result.current.zoomToPercent(400)
    })

    act(() => {
      result.current.panBy(-1e6, 0)
    })
    expect(result.current.viewport.x).toBeCloseTo(1 - 1000 / (2000 * 4) / 2, 8)

    act(() => {
      result.current.centreOn({ x: 0.25, y: 0.5 })
    })
    expect(result.current.viewport.x).toBe(0.25)
  })

  it('is kept within the window when the window grows', () => {
    measured()
    const { result } = view()
    act(() => {
      result.current.zoomToPercent(400)
      result.current.centreOn({ x: 0.95, y: 0.5 })
    })

    act(() => {
      useUiStore
        .getState()
        .setViewFrame(ID, { ...FRAME, viewWidth: 4000, viewHeight: 2000 })
    })

    const { zoom, x } = result.current.viewport
    expect(zoom).toBe(result.current.viewport.zoom)
    expect(x).toBeLessThanOrEqual(1 - 4000 / (4000 * zoom) / 2)
  })

  it('keeps each document’s view apart, and forgets it with the document', () => {
    measured()
    useUiStore.getState().setViewFrame('other', FRAME)
    const { result } = view()
    act(() => {
      result.current.zoomIn()
    })

    expect(useUiStore.getState().viewports.other).toEqual({
      zoom: 0.5,
      x: 0.5,
      y: 0.5,
    })

    act(() => {
      forgetItem(ID)
    })
    expect(useUiStore.getState().viewports[ID]).toBeUndefined()
    expect(useUiStore.getState().viewFrames[ID]).toBeUndefined()
  })
})
