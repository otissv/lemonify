import { useRef } from 'react'

import { cn } from '@/lib/utils'

/** How far one arrow key press moves the handle, as a share of the bounds. */
const KEY_STEP = 0.05
const PERCENT = 100

interface ResizeHandleProps {
  /** Names what is resized, for assistive technology. */
  label: string
  /** The share of the bounds' width the resized panel takes, from 0 to 1. */
  value: number
  /** The share that double-click and Enter restore. */
  defaultValue: number
  min: number
  max: number
  /** Which side of the handle the resized panel is on. */
  panelSide: 'start' | 'end'
  /** The element whose width the share is of: the one holding both panels and the handle. */
  boundsRef: React.RefObject<HTMLElement | null>
  onChange: (value: number) => void
  className?: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * The border between two side-by-side panels, dragged to give one of them a
 * larger or smaller share of the width. It is a window splitter in the WAI-ARIA
 * sense: focusable, moved with the arrow keys, Home and End go to its limits,
 * and Enter or a double-click restores the default share.
 */
export function ResizeHandle({
  label,
  value,
  defaultValue,
  min,
  max,
  panelSide,
  boundsRef,
  onChange,
  className,
}: ResizeHandleProps): React.JSX.Element {
  const dragging = useRef(false)

  function shareAt(clientX: number): number | undefined {
    const bounds = boundsRef.current?.getBoundingClientRect()
    if (bounds === undefined || bounds.width <= 0) return undefined
    const fromStart = (clientX - bounds.left) / bounds.width
    return panelSide === 'end' ? 1 - fromStart : fromStart
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = true
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (!dragging.current) return
    const share = shareAt(event.clientX)
    if (share !== undefined) onChange(clamp(share, min, max))
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    if (!dragging.current) return
    dragging.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const towardsPanel = panelSide === 'end' ? 'ArrowRight' : 'ArrowLeft'
    const awayFromPanel = panelSide === 'end' ? 'ArrowLeft' : 'ArrowRight'
    const next: Readonly<Record<string, number | undefined>> = {
      [awayFromPanel]: value + KEY_STEP,
      [towardsPanel]: value - KEY_STEP,
      Home: min,
      End: max,
      Enter: defaultValue,
    }
    const chosen = next[event.key]
    if (chosen === undefined) return
    event.preventDefault()
    onChange(clamp(chosen, min, max))
  }

  function handleDoubleClick(): void {
    onChange(clamp(defaultValue, min, max))
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be focused or dragged; a focusable separator is the WAI-ARIA window splitter
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={Math.round(value * PERCENT)}
      aria-valuemin={Math.round(min * PERCENT)}
      aria-valuemax={Math.round(max * PERCENT)}
      tabIndex={0}
      data-slot="resize-handle"
      className={cn(
        'relative z-10 w-px shrink-0 cursor-col-resize touch-none bg-border outline-none transition-colors',
        'after:absolute after:inset-y-0 after:-inset-x-1.5 after:content-[""]',
        'hover:bg-ring focus-visible:bg-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      onDoubleClick={handleDoubleClick}
    />
  )
}
