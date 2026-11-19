import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'

import { dragBox, nudgeBox, sameBox } from '@/features/overlay/box-geometry'
import type { Box, BoxHandle, Size } from '@/features/overlay/box-geometry'

/** How far an arrow key moves the box, in image pixels, and with Shift. */
export const NUDGE_PIXELS = 1
export const BIG_NUDGE_PIXELS = 10

const NUDGES: Readonly<Record<string, readonly [number, number] | undefined>> =
  {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }

export interface UseBoxDragOptions {
  /** The box as saved; a drag starts from it. */
  box: Box
  /** The picture the box must stay inside, in image pixels. */
  bounds: Size
  /** Screen pixels per image pixel, so a drag of the pointer is a drag of the picture. */
  scale: number
  /** Called on every move with the box as it would be. Nothing is saved yet. */
  onDraft: (box: Box) => void
  /** Called once, with the final box, when a drag ends or an arrow key is pressed. */
  onCommit: (box: Box) => void
}

export interface BoxHandleProps {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void
  onPointerMove: (event: PointerEvent<HTMLElement>) => void
  onPointerUp: (event: PointerEvent<HTMLElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  onDoubleClick: (event: MouseEvent<HTMLElement>) => void
}

type Drag = { handle: BoxHandle; x: number; y: number; start: Box; last: Box }

/**
 * Dragging a box on the picture, for any tool that has one: the geometry is
 * `dragBox`, and this turns pointer and key events into drafts and one commit.
 * Shift keeps the aspect ratio, Alt resizes about the middle, Escape puts the
 * box back, and the arrow keys nudge it. A tool only supplies the box and what
 * to do with it, and gets props for each handle it draws.
 */
export function useBoxDrag(
  options: UseBoxDragOptions,
): (handle: BoxHandle) => BoxHandleProps {
  const { box, bounds, scale, onDraft, onCommit } = options
  const drag = useRef<Drag | undefined>(undefined)
  const stopListening = useRef<(() => void) | undefined>(undefined)
  const cancel = useRef<() => void>(() => {})

  useEffect(
    () => () => {
      stopListening.current?.()
    },
    [],
  )

  const handleMove = useCallback(
    (event: PointerEvent<HTMLElement>): void => {
      const current = drag.current
      if (!current) return
      const next = dragBox(
        current.start,
        current.handle,
        {
          x: (event.clientX - current.x) / scale,
          y: (event.clientY - current.y) / scale,
        },
        bounds,
        { keepAspect: event.shiftKey, fromCentre: event.altKey },
      )
      current.last = next
      onDraft(next)
    },
    [bounds, scale, onDraft],
  )

  const handleEnd = useCallback(
    (cancelled: boolean): void => {
      const current = drag.current
      drag.current = undefined
      stopListening.current?.()
      stopListening.current = undefined
      if (!current) return
      if (cancelled) {
        onDraft(current.start)
        return
      }
      if (sameBox(current.last, current.start)) return
      onCommit(current.last)
    },
    [onDraft, onCommit],
  )

  const handleKey = useCallback(
    (event: KeyboardEvent<HTMLElement>): void => {
      if (event.key === 'Escape' && drag.current) {
        event.stopPropagation()
        handleEnd(true)
        return
      }
      const nudge = NUDGES[event.key]
      if (!nudge) return
      event.preventDefault()
      event.stopPropagation()
      const step = event.shiftKey ? BIG_NUDGE_PIXELS : NUDGE_PIXELS
      const next = nudgeBox(box, nudge[0] * step, nudge[1] * step, bounds)
      if (!sameBox(next, box)) onCommit(next)
    },
    [box, bounds, onCommit, handleEnd],
  )

  useEffect(() => {
    cancel.current = () => {
      handleEnd(true)
    }
  }, [handleEnd])

  return useMemo(
    () =>
      (handle: BoxHandle): BoxHandleProps => ({
        onPointerDown: (event) => {
          event.stopPropagation()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = {
            handle,
            x: event.clientX,
            y: event.clientY,
            start: box,
            last: box,
          }
          stopListening.current?.()
          const handleEscape = (pressed: globalThis.KeyboardEvent): void => {
            if (pressed.key === 'Escape') cancel.current()
          }
          document.addEventListener('keydown', handleEscape)
          stopListening.current = () => {
            document.removeEventListener('keydown', handleEscape)
          }
        },
        onPointerMove: handleMove,
        onPointerUp: () => {
          handleEnd(false)
        },
        onPointerCancel: () => {
          handleEnd(true)
        },
        onKeyDown: handleKey,
        onDoubleClick: (event) => {
          event.stopPropagation()
        },
      }),
    [box, handleMove, handleEnd, handleKey],
  )
}
