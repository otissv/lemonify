import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BoxEditor } from '@/features/overlay/box-editor'
import { OverlayContext } from '@/features/overlay/overlay-context'
import { OverlayGuide, guidePath } from '@/features/overlay/grid-guides'
import { resetStores } from '@/store/reset-stores'
import { useUiStore } from '@/store/ui-store'
import type { Box } from '@/features/overlay/box-geometry'

beforeEach(() => {
  resetStores()
})

const BOX: Box = { left: 100, top: 50, width: 200, height: 100 }

function setup(box: Box = BOX, scale = 1) {
  const onCommit = vi.fn()
  render(
    <OverlayContext value={{ size: { width: 1000, height: 500 }, scale }}>
      <BoxEditor label="Extract region" box={box} onCommit={onCommit} />
    </OverlayContext>,
  )
  return { onCommit }
}

function drag(
  element: HTMLElement,
  from: [number, number],
  to: [number, number],
) {
  element.setPointerCapture = vi.fn()
  fireEvent.pointerDown(element, {
    pointerId: 1,
    clientX: from[0],
    clientY: from[1],
  })
  fireEvent.pointerMove(element, {
    pointerId: 1,
    clientX: to[0],
    clientY: to[1],
  })
  fireEvent.pointerUp(element, { pointerId: 1, clientX: to[0], clientY: to[1] })
}

describe('BoxEditor guides', () => {
  it('draws no lines unless a guide is chosen', () => {
    setup()
    expect(screen.queryByTestId('overlay-guide')).not.toBeInTheDocument()
  })

  it.each(
    Object.values(OverlayGuide).filter((guide) => guide !== OverlayGuide.None),
  )("draws the %s guide inside the box, in the box's own pixels", (guide) => {
    act(() => useUiStore.getState().setOverlayGuide(guide))
    setup()
    const drawn = screen.getByTestId('overlay-guide')
    expect(drawn.getAttribute('viewBox')).toBe('0 0 200 100')
    expect(drawn.querySelector('path')?.getAttribute('d')).toBe(
      guidePath(guide, 200, 100),
    )
  })

  it('follows the box while it is dragged', () => {
    act(() => useUiStore.getState().setOverlayGuide(OverlayGuide.Thirds))
    setup()
    const handle = screen.getByRole('button', {
      name: /resize extract region from the bottom-right corner/i,
    })
    handle.setPointerCapture = vi.fn()
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100, clientY: 50 })
    expect(screen.getByTestId('overlay-guide').getAttribute('viewBox')).toBe(
      '0 0 300 150',
    )
  })

  it('is not a stop for a screen reader or the pointer', () => {
    act(() => useUiStore.getState().setOverlayGuide(OverlayGuide.Grid))
    setup()
    const drawn = screen.getByTestId('overlay-guide')
    expect(drawn.getAttribute('aria-hidden')).toBe('true')
    expect(drawn.getAttribute('class')).toContain('pointer-events-none')
  })
})

describe('BoxEditor', () => {
  it('places the box as a share of the picture', () => {
    setup()
    const box = screen.getByTestId('overlay-box')
    expect(box.style.left).toBe('10%')
    expect(box.style.top).toBe('10%')
    expect(box.style.width).toBe('20%')
    expect(box.style.height).toBe('20%')
  })

  it('names the box and every handle for a screen reader', () => {
    setup()
    expect(
      screen.getByRole('button', { name: /move extract region/i }),
    ).toBeInTheDocument()
    for (const side of [
      'top-left corner',
      'top edge',
      'top-right corner',
      'right edge',
      'bottom-right corner',
      'bottom edge',
      'bottom-left corner',
      'left edge',
    ]) {
      expect(
        screen.getByRole('button', {
          name: new RegExp(`resize extract region from the ${side}`, 'i'),
        }),
      ).toBeInTheDocument()
    }
  })

  it('moves the box with its middle and saves it once on release', () => {
    const { onCommit } = setup()
    drag(
      screen.getByRole('button', { name: /move extract region/i }),
      [0, 0],
      [30, 20],
    )
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith({
      left: 130,
      top: 70,
      width: 200,
      height: 100,
    })
  })

  it('turns pointer distance into picture pixels at the zoom it is shown at', () => {
    const { onCommit } = setup(BOX, 2)
    drag(
      screen.getByRole('button', {
        name: /resize extract region from the bottom-right corner/i,
      }),
      [0, 0],
      [20, 10],
    )
    expect(onCommit).toHaveBeenCalledWith({
      left: 100,
      top: 50,
      width: 210,
      height: 105,
    })
  })

  it('shows the box as it is dragged, with its size, before anything is saved', () => {
    const { onCommit } = setup()
    const handle = screen.getByRole('button', {
      name: /resize extract region from the bottom-right corner/i,
    })
    handle.setPointerCapture = vi.fn()
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100, clientY: 50 })

    expect(screen.getByTestId('overlay-box').style.width).toBe('30%')
    expect(screen.getByTestId('overlay-readout')).toHaveTextContent('300 × 150')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('puts the box back when the drag is cancelled with Escape', () => {
    const { onCommit } = setup()
    const handle = screen.getByRole('button', { name: /move extract region/i })
    handle.setPointerCapture = vi.fn()
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 50, clientY: 50 })
    fireEvent.keyDown(handle, { key: 'Escape' })
    fireEvent.pointerUp(handle, { pointerId: 1 })

    expect(screen.getByTestId('overlay-box').style.left).toBe('10%')
    expect(screen.queryByTestId('overlay-readout')).not.toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('nudges with the arrow keys, ten pixels with Shift', () => {
    const { onCommit } = setup()
    const handle = screen.getByRole('button', { name: /move extract region/i })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true })
    expect(onCommit).toHaveBeenNthCalledWith(1, {
      left: 101,
      top: 50,
      width: 200,
      height: 100,
    })
    expect(onCommit).toHaveBeenNthCalledWith(2, {
      left: 100,
      top: 60,
      width: 200,
      height: 100,
    })
  })

  it('does not hand a pointer press to the canvas behind it, which would pan', () => {
    const behind = vi.fn()
    render(
      <div onPointerDown={behind}>
        <OverlayContext
          value={{ size: { width: 1000, height: 500 }, scale: 1 }}
        >
          <BoxEditor label="Extract region" box={BOX} onCommit={vi.fn()} />
        </OverlayContext>
      </div>,
    )
    const handle = screen.getByRole('button', { name: /move extract region/i })
    handle.setPointerCapture = vi.fn()
    fireEvent.pointerDown(handle, { pointerId: 1 })
    expect(behind).not.toHaveBeenCalled()
  })

  it('follows the saved box when it changes elsewhere', () => {
    const onCommit = vi.fn()
    const context = { size: { width: 1000, height: 500 }, scale: 1 }
    const { rerender } = render(
      <OverlayContext value={context}>
        <BoxEditor label="Extract region" box={BOX} onCommit={onCommit} />
      </OverlayContext>,
    )
    rerender(
      <OverlayContext value={context}>
        <BoxEditor
          label="Extract region"
          box={{ left: 500, top: 0, width: 500, height: 250 }}
          onCommit={onCommit}
        />
      </OverlayContext>,
    )
    expect(screen.getByTestId('overlay-box').style.left).toBe('50%')
  })
})
