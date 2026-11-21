import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Canvas } from '@/features/documents/canvas'
import { percentOf } from '@/features/viewport/viewport'
import type { Viewport } from '@/features/viewport/viewport'
import { useUiStore } from '@/store/ui-store'
import { resetStores } from '@/store/reset-stores'

const ID = 'doc'

function box(width: number, height: number): DOMRect {
  return DOMRect.fromRect({ x: 0, y: 0, width, height })
}

/** A 2000 x 1000 picture in a 1000 x 800 window: it fits at 50%. */
function show(): HTMLElement {
  render(
    <Canvas id={ID} url="/a.png" name="a.png" width={2000} height={1000} />,
  )
  const picture = screen.getByRole('img', { name: 'a.png' })
  Object.defineProperty(picture, 'naturalWidth', { value: 2000 })
  Object.defineProperty(picture, 'naturalHeight', { value: 1000 })
  fireEvent.load(picture)
  return screen.getByRole('application', { name: 'Canvas' })
}

function viewport(): Viewport {
  const stored = useUiStore.getState().viewports[ID]
  if (!stored) throw new Error('The canvas has not been measured.')
  return stored
}

function setView(zoom: number, x: number, y: number): void {
  act(() => {
    useUiStore.getState().setViewport(ID, { zoom, x, y })
  })
}

function percent(): number {
  return percentOf(viewport().zoom)
}

function canvasBox(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-slot="canvas"]')
  if (!element) throw new Error('No canvas.')
  return element
}

beforeEach(() => {
  resetStores()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function measure(this: HTMLElement) {
      return this.dataset.slot === 'canvas-window' ? box(1000, 800) : box(0, 0)
    },
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Canvas zoom and pan', () => {
  it('tells the store how big the window and the picture are', () => {
    show()

    expect(useUiStore.getState().viewFrames[ID]).toEqual({
      viewWidth: 1000,
      viewHeight: 800,
      pictureWidth: 2000,
      pictureHeight: 1000,
    })
  })

  it('lays the picture out at its own size, in its own pixels', () => {
    show()

    expect(canvasBox().style.width).toBe('2000px')
    expect(canvasBox().style.height).toBe('1000px')
  })

  it('opens a picture bigger than the window fitted to it, and not moved', () => {
    show()

    expect(percent()).toBe(50)
    expect(canvasBox().style.transform).toMatch(
      /^translate\(0px(, 0px)?\) scale\(0.5\)$/,
    )
  })

  it('opens a picture smaller than the window at actual size', () => {
    render(
      <Canvas id={ID} url="/a.png" name="a.png" width={400} height={200} />,
    )

    expect(percent()).toBe(100)
    expect(canvasBox().style.transform).toMatch(/scale\(1\)$/)
  })

  it('measures 100% against the picture’s own size, not the smaller preview it is shown with', () => {
    render(
      <Canvas id={ID} url="/a.png" name="a.png" width={6000} height={3000} />,
    )
    const picture = screen.getByRole('img', { name: 'a.png' })
    Object.defineProperty(picture, 'naturalWidth', { value: 2560 })
    Object.defineProperty(picture, 'naturalHeight', { value: 1280 })
    fireEvent.load(picture)

    expect(useUiStore.getState().viewFrames[ID]?.pictureWidth).toBe(6000)
    expect(canvasBox().style.width).toBe('6000px')
  })

  it('has no zoom control of its own, since the Navigator has it', () => {
    show()

    expect(screen.queryByRole('textbox', { name: 'Zoom' })).toBeNull()
  })

  it('zooms about the pointer with Ctrl and the wheel, and about the middle with a pinch', () => {
    const window = show()

    fireEvent.wheel(window, {
      deltaY: -50,
      ctrlKey: true,
      clientX: 0,
      clientY: 400,
    })

    expect(viewport().zoom).toBeCloseTo(0.5 * Math.exp(0.5), 8)
    expect(viewport().x).toBeLessThan(0.5)
  })

  it('zooms out with the wheel turned the other way, to see the picture small', () => {
    const window = show()

    fireEvent.wheel(window, { deltaY: 50, ctrlKey: true })

    expect(viewport().zoom).toBeCloseTo(0.5 * Math.exp(-0.5), 8)
    expect(percent()).toBeLessThan(50)
  })

  it('zooms with Cmd or Alt and the wheel too', () => {
    const window = show()

    fireEvent.wheel(window, { deltaY: -20, metaKey: true })
    const afterCmd = viewport().zoom
    fireEvent.wheel(window, { deltaY: -20, altKey: true })

    expect(afterCmd).toBeGreaterThan(0.5)
    expect(viewport().zoom).toBeGreaterThan(afterCmd)
  })

  it('stops the page scrolling or zooming when the wheel is used on it', () => {
    const window = show()

    const plain = fireEvent.wheel(window, { deltaY: 40 })
    const zoom = fireEvent.wheel(window, { deltaY: 40, ctrlKey: true })

    expect(plain).toBe(false)
    expect(zoom).toBe(false)
  })

  it('moves the picture with the wheel once zoomed in', () => {
    const window = show()
    setView(4, 0.5, 0.5)

    fireEvent.wheel(window, { deltaY: 100, deltaX: 40 })

    expect(viewport().y).toBeGreaterThan(0.5)
    expect(viewport().x).toBeGreaterThan(0.5)
  })

  it('moves the picture by dragging it', () => {
    const window = show()
    setView(4, 0.5, 0.5)

    fireEvent.pointerDown(window, { pointerId: 1, clientX: 500, clientY: 400 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 600, clientY: 400 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 600, clientY: 400 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 900, clientY: 400 })

    expect(viewport().x).toBeCloseTo(0.5 - 100 / (2000 * 4), 8)
  })

  it('pinches with two fingers', () => {
    const window = show()

    fireEvent.pointerDown(window, { pointerId: 1, clientX: 400, clientY: 400 })
    fireEvent.pointerDown(window, { pointerId: 2, clientX: 600, clientY: 400 })
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 800, clientY: 400 })

    expect(viewport().zoom).toBeCloseTo(1, 8)
  })

  it('swaps between fit and actual size with a double click', () => {
    const window = show()

    fireEvent.doubleClick(window, { clientX: 500, clientY: 400 })
    expect(percent()).toBe(100)

    fireEvent.doubleClick(window, { clientX: 500, clientY: 400 })
    expect(viewport().zoom).toBe(0.5)
  })

  it('moves and scales the picture to match the view', () => {
    show()
    setView(2, 0.25, 0.5)

    // The picture is 2000 wide, so 4000 at 200%; the view's middle is x 0.25 of it.
    expect(canvasBox().style.transform).toMatch(
      /^translate\(1000px(, 0px)?\) scale\(2\)$/,
    )
  })

  it('shows pixels as squares from 400%', () => {
    show()
    const picture = screen.getByRole('img', { name: 'a.png' })
    expect(picture).not.toHaveClass('[image-rendering:pixelated]')

    setView(4, 0.5, 0.5)

    expect(picture).toHaveClass('[image-rendering:pixelated]')
  })

  it('shows a grab cursor only while there is more picture to move to', () => {
    const window = show()
    expect(window).not.toHaveClass('cursor-grab')

    setView(1, 0.5, 0.5)

    expect(window).toHaveClass('cursor-grab')
  })
})

describe('Canvas overlay', () => {
  it('draws the overlay on the picture, inside the box that is zoomed and moved with it', () => {
    render(
      <Canvas
        id={ID}
        url="/a.png"
        name="a.png"
        width={2000}
        height={1000}
        overlay={<p data-testid="tool">tool</p>}
      />,
    )
    const picture = screen.getByRole('img', { name: 'a.png' })
    Object.defineProperty(picture, 'naturalWidth', { value: 2000 })
    Object.defineProperty(picture, 'naturalHeight', { value: 1000 })
    fireEvent.load(picture)

    expect(canvasBox()).toContainElement(screen.getByTestId('tool'))
  })

  it('holds the overlay back until the picture it was made for has loaded', () => {
    const { rerender } = render(
      <Canvas
        id={ID}
        url="/a.png"
        name="a.png"
        width={2000}
        height={1000}
        overlay={<p data-testid="tool">tool</p>}
      />,
    )
    const picture = screen.getByRole('img', { name: 'a.png' })
    Object.defineProperty(picture, 'naturalWidth', { value: 2000 })
    Object.defineProperty(picture, 'naturalHeight', { value: 1000 })
    fireEvent.load(picture)

    rerender(
      <Canvas
        id={ID}
        url="/b.png"
        name="a.png"
        width={2000}
        height={1000}
        overlay={<p data-testid="tool">tool</p>}
      />,
    )

    expect(screen.queryByTestId('tool')).not.toBeInTheDocument()
  })
})
