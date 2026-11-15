import { RiDraggable } from '@remixicon/react'
import { useEffect, useId, useRef } from 'react'

import {
  clampPosition,
  defaultPosition,
  nudgePosition,
} from '@/features/tools/panel-position'
import type { PanelPosition, Size } from '@/features/tools/panel-position'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'

interface FloatingPanelProps {
  label: string
  className?: string
  /** Shown in the top row, beside the handle that moves the panel. */
  menu?: React.ReactNode
  /** What sits under the top row. With none, the row has no line under it. */
  children?: React.ReactNode
}

interface DragStart {
  pointerX: number
  pointerY: number
  position: PanelPosition
}

function sizeOf(element: Element | null): Size {
  const { width, height } = element?.getBoundingClientRect() ?? {
    width: 0,
    height: 0,
  }
  return { width, height }
}

/** A non-modal panel that floats over its positioned parent and can be dragged or moved with the arrow keys. */
export function FloatingPanel({
  label,
  className,
  menu,
  children,
}: FloatingPanelProps): React.JSX.Element {
  const panelRef = useRef<HTMLElement>(null)
  const dragStart = useRef<DragStart | null>(null)
  const hintId = useId()
  const position = useAppStore((state) => state.panelPosition)
  const setPosition = useAppStore((state) => state.setPanelPosition)

  function measure(): { panel: Size; container: Size } {
    const panel = panelRef.current
    return {
      panel: sizeOf(panel),
      container: sizeOf(panel?.parentElement ?? null),
    }
  }

  function currentPosition(): PanelPosition {
    const { panel, container } = measure()
    return position ?? defaultPosition(panel, container)
  }

  function moveTo(next: PanelPosition): void {
    const { panel, container } = measure()
    setPosition(clampPosition(next, panel, container))
  }

  useEffect(() => {
    const container = panelRef.current?.parentElement
    if (!container || position === null) return
    const observer = new ResizeObserver(() => {
      const { panel, container: bounds } = measure()
      const clamped = clampPosition(position, panel, bounds)
      if (clamped.x !== position.x || clamped.y !== position.y)
        setPosition(clamped)
    })
    observer.observe(container)
    return () => observer.disconnect()
  })

  function handlePointerDown(
    event: React.PointerEvent<HTMLButtonElement>,
  ): void {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStart.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      position: currentPosition(),
    }
  }

  function handlePointerMove(
    event: React.PointerEvent<HTMLButtonElement>,
  ): void {
    const start = dragStart.current
    if (!start) return
    moveTo({
      x: start.position.x + event.clientX - start.pointerX,
      y: start.position.y + event.clientY - start.pointerY,
    })
  }

  function handlePointerUp(event: React.PointerEvent<HTMLButtonElement>): void {
    dragStart.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    const next = nudgePosition(currentPosition(), event.key, event.shiftKey)
    if (!next) return
    event.preventDefault()
    moveTo(next)
  }

  return (
    <section
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={label}
      data-slot="floating-panel"
      className={cn(
        'absolute z-10 flex max-h-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border border-white/20 bg-background/60 text-card-foreground [--muted-foreground:color-mix(in_oklab,var(--foreground)_95%,var(--card))] [&_[data-slot=input]]:bg-background/70 [&_[data-slot=select-trigger]]:bg-background/70 backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3),0_8px_32px_rgb(0_0_0/0.35)]',
        position === null && 'top-4 right-4',
        className,
      )}
      style={
        position
          ? { left: `${position.x}px`, top: `${position.y}px` }
          : undefined
      }
    >
      <div
        className={cn(
          'flex min-h-10 shrink-0 items-center px-1',
          children !== undefined && 'border-b border-white/15',
        )}
      >
        {menu}
        <button
          type="button"
          aria-label="Move panel"
          aria-describedby={hintId}
          className="flex min-w-6 flex-1 cursor-grab self-stretch touch-none items-center justify-end px-2 text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
        >
          <span id={hintId} className="sr-only">
            Drag, or use the arrow keys, to move the panel. Hold Shift to move
            further.
          </span>
          <RiDraggable aria-hidden="true" className="size-4" />
        </button>
      </div>
      {children}
    </section>
  )
}
