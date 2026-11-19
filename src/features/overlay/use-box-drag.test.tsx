import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Box } from '@/features/overlay/box-geometry'
import { useBoxDrag } from '@/features/overlay/use-box-drag'

const START: Box = { left: 100, top: 100, width: 200, height: 100 }
const BOUNDS = { width: 1000, height: 500 }

type PointerLike = {
  pointerId: number
  clientX: number
  clientY: number
  shiftKey: boolean
  altKey: boolean
  stopPropagation: () => void
  currentTarget: { setPointerCapture: (id: number) => void }
}

function pointer(x: number, y: number, extra: Partial<PointerLike> = {}) {
  return {
    pointerId: 1,
    clientX: x,
    clientY: y,
    shiftKey: false,
    altKey: false,
    stopPropagation: vi.fn(),
    currentTarget: { setPointerCapture: vi.fn() },
    ...extra,
  } as unknown as React.PointerEvent<HTMLElement>
}

function key(name: string, shiftKey = false) {
  return {
    key: name,
    shiftKey,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.KeyboardEvent<HTMLElement>
}

function setup(scale = 1) {
  const onDraft = vi.fn()
  const onCommit = vi.fn()
  const hook = renderHook(() =>
    useBoxDrag({ box: START, bounds: BOUNDS, scale, onDraft, onCommit }),
  )
  return { onDraft, onCommit, bind: hook.result.current }
}

describe('useBoxDrag', () => {
  it('drafts the box while the pointer moves and commits it on release', () => {
    const { onDraft, onCommit, bind } = setup()
    const handlers = bind('se')

    act(() => handlers.onPointerDown(pointer(0, 0)))
    act(() => handlers.onPointerMove(pointer(30, 10)))

    expect(onDraft).toHaveBeenLastCalledWith({
      left: 100,
      top: 100,
      width: 230,
      height: 110,
    })
    expect(onCommit).not.toHaveBeenCalled()

    act(() => handlers.onPointerUp(pointer(30, 10)))

    expect(onCommit).toHaveBeenCalledWith({
      left: 100,
      top: 100,
      width: 230,
      height: 110,
    })
  })

  it('turns screen pixels into image pixels by the scale', () => {
    const { onDraft, bind } = setup(0.5)
    const handlers = bind('move')

    act(() => handlers.onPointerDown(pointer(0, 0)))
    act(() => handlers.onPointerMove(pointer(10, 20)))

    expect(onDraft).toHaveBeenLastCalledWith({
      left: 120,
      top: 140,
      width: 200,
      height: 100,
    })
  })

  it('keeps the aspect ratio with Shift and resizes about the middle with Alt', () => {
    const { onDraft, bind } = setup()
    const handlers = bind('se')

    act(() => handlers.onPointerDown(pointer(0, 0)))
    act(() => handlers.onPointerMove(pointer(40, 0, { shiftKey: true })))
    expect(onDraft).toHaveBeenLastCalledWith({
      left: 100,
      top: 100,
      width: 240,
      height: 120,
    })

    act(() => handlers.onPointerMove(pointer(10, 10, { altKey: true })))
    expect(onDraft).toHaveBeenLastCalledWith({
      left: 90,
      top: 90,
      width: 220,
      height: 120,
    })
  })

  it('captures the pointer and keeps the press from reaching the pan gesture', () => {
    const { bind } = setup()
    const down = pointer(0, 0)

    act(() => bind('move').onPointerDown(down))

    expect(down.stopPropagation).toHaveBeenCalled()
    expect(down.currentTarget.setPointerCapture).toHaveBeenCalledWith(1)
  })

  it('puts the box back on Escape pressed anywhere, not only on the handle, since a press does not always focus it', () => {
    const { onDraft, onCommit, bind } = setup()
    const handlers = bind('e')

    act(() => handlers.onPointerDown(pointer(0, 0)))
    act(() => handlers.onPointerMove(pointer(50, 0)))
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    act(() => handlers.onPointerUp(pointer(50, 0)))

    expect(onDraft).toHaveBeenLastCalledWith(START)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('stops listening for Escape once the drag has ended', () => {
    const { onDraft, bind } = setup()
    const handlers = bind('e')

    act(() => handlers.onPointerDown(pointer(0, 0)))
    act(() => handlers.onPointerUp(pointer(0, 0)))
    onDraft.mockClear()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(onDraft).not.toHaveBeenCalled()
  })

  it('stops listening for Escape when it is taken off the page mid-drag', () => {
    const onDraft = vi.fn()
    const hook = renderHook(() =>
      useBoxDrag({
        box: START,
        bounds: BOUNDS,
        scale: 1,
        onDraft,
        onCommit: vi.fn(),
      }),
    )
    act(() => hook.result.current('e').onPointerDown(pointer(0, 0)))
    hook.unmount()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(onDraft).not.toHaveBeenCalled()
  })

  it('keeps a double press from reaching the canvas, which would zoom', () => {
    const { bind } = setup()
    const event = {
      stopPropagation: vi.fn(),
    } as unknown as React.MouseEvent<HTMLElement>

    bind('move').onDoubleClick(event)

    expect(event.stopPropagation).toHaveBeenCalled()
  })

  it('ignores moves when nothing is being dragged', () => {
    const { onDraft, onCommit, bind } = setup()

    act(() => bind('move').onPointerMove(pointer(50, 50)))
    act(() => bind('move').onPointerUp(pointer(50, 50)))

    expect(onDraft).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('puts the box back and commits nothing on Escape or a cancelled pointer', () => {
    const { onDraft, onCommit, bind } = setup()
    const handlers = bind('e')

    act(() => handlers.onPointerDown(pointer(0, 0)))
    act(() => handlers.onPointerMove(pointer(50, 0)))
    act(() => handlers.onKeyDown(key('Escape')))

    expect(onDraft).toHaveBeenLastCalledWith(START)
    act(() => handlers.onPointerUp(pointer(50, 0)))
    expect(onCommit).not.toHaveBeenCalled()

    act(() => handlers.onPointerDown(pointer(0, 0)))
    act(() => handlers.onPointerMove(pointer(50, 0)))
    act(() => handlers.onPointerCancel(pointer(50, 0)))
    expect(onDraft).toHaveBeenLastCalledWith(START)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits nothing for a click that moved nothing', () => {
    const { onCommit, bind } = setup()
    const handlers = bind('move')

    act(() => handlers.onPointerDown(pointer(5, 5)))
    act(() => handlers.onPointerUp(pointer(5, 5)))

    expect(onCommit).not.toHaveBeenCalled()
  })

  it('nudges with the arrow keys by one pixel, or ten with Shift, committing each', () => {
    const { onCommit, bind } = setup()
    const handlers = bind('move')
    const right = key('ArrowRight')
    const down = key('ArrowDown', true)

    act(() => handlers.onKeyDown(right))
    expect(onCommit).toHaveBeenLastCalledWith({ ...START, left: 101 })
    expect(right.preventDefault).toHaveBeenCalled()

    act(() => handlers.onKeyDown(down))
    expect(onCommit).toHaveBeenLastCalledWith({ ...START, top: 110 })

    act(() => handlers.onKeyDown(key('a')))
    expect(onCommit).toHaveBeenCalledTimes(2)
  })
})
