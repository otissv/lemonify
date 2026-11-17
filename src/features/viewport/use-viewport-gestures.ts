import { useCallback, useEffect, useRef } from 'react'
import type { PointerEvent, RefObject } from 'react'

import { useViewportActions } from '@/features/viewport/use-viewport'
import type { Point } from '@/features/viewport/viewport'

/** How much one unit of wheel travel zooms; a pinch on a trackpad arrives as small ctrl-wheel steps. */
const WHEEL_ZOOM_RATE = 0.01
const MAX_WHEEL_TRAVEL = 50
const LINE_HEIGHT = 16
const DOM_DELTA_LINE = 1

export interface ViewportGestureHandlers {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void
  onPointerMove: (event: PointerEvent<HTMLElement>) => void
  onPointerUp: (event: PointerEvent<HTMLElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void
  onDoubleClick: (event: React.MouseEvent<HTMLElement>) => void
}

function within(
  element: HTMLElement,
  event: { clientX: number; clientY: number },
): Point {
  const box = element.getBoundingClientRect()
  return { x: event.clientX - box.left, y: event.clientY - box.top }
}

function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function middleOf(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function wheelTravel(event: WheelEvent): number {
  const lines = event.deltaMode === DOM_DELTA_LINE ? LINE_HEIGHT : 1
  return event.deltaY * lines
}

/**
 * Zoom and pan on the canvas: the wheel scrolls the picture, and with Ctrl,
 * Cmd or Alt (or a pinch on a trackpad) it zooms about the pointer; dragging
 * moves the picture; two fingers pinch and move it; a double click swaps
 * between fit and actual size; the keys are the key bindings'. Every change goes through the same actions the
 * Navigator uses.
 */
export function useViewportGestures(
  ref: RefObject<HTMLElement | null>,
  documentId: string,
): ViewportGestureHandlers {
  const actions = useViewportActions(documentId)
  const pointers = useRef(new Map<number, Point>())

  useEffect(() => {
    const element = ref.current
    if (!element) return
    function handleWheel(event: WheelEvent): void {
      if (!element) return
      event.preventDefault()
      if (event.ctrlKey || event.metaKey || event.altKey) {
        const travel = Math.max(
          -MAX_WHEEL_TRAVEL,
          Math.min(MAX_WHEEL_TRAVEL, wheelTravel(event)),
        )
        actions.zoomBy(
          Math.exp(-travel * WHEEL_ZOOM_RATE),
          within(element, event),
        )
        return
      }
      actions.panBy(-event.deltaX, -wheelTravel(event))
    }
    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      element.removeEventListener('wheel', handleWheel)
    }
  }, [ref, actions])

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLElement>): void => {
      if (
        event.pointerType === 'mouse' &&
        event.button !== 0 &&
        event.button !== 1
      ) {
        return
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      pointers.current.set(event.pointerId, within(event.currentTarget, event))
    },
    [],
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLElement>): void => {
      const previous = pointers.current.get(event.pointerId)
      if (!previous) return
      const now = within(event.currentTarget, event)
      const others = [...pointers.current.entries()].filter(
        ([id]) => id !== event.pointerId,
      )
      const other = others.at(0)?.[1]
      pointers.current.set(event.pointerId, now)
      if (!other) {
        actions.panBy(now.x - previous.x, now.y - previous.y)
        return
      }
      const before = distanceBetween(previous, other)
      const after = distanceBetween(now, other)
      const middleBefore = middleOf(previous, other)
      const middleAfter = middleOf(now, other)
      actions.panBy(
        middleAfter.x - middleBefore.x,
        middleAfter.y - middleBefore.y,
      )
      if (before > 0 && after > 0) actions.zoomBy(after / before, middleAfter)
    },
    [actions],
  )

  const handlePointerEnd = useCallback(
    (event: PointerEvent<HTMLElement>): void => {
      pointers.current.delete(event.pointerId)
    },
    [],
  )

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLElement>): void => {
      actions.toggleActualSize(within(event.currentTarget, event))
    },
    [actions],
  )

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerEnd,
    onPointerCancel: handlePointerEnd,
    onDoubleClick: handleDoubleClick,
  }
}
