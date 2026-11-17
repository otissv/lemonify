import { useRef } from 'react'

import { useShownPicture } from '@/features/documents/use-shown-picture'
import { useViewport } from '@/features/viewport/use-viewport'
import { visibleRect } from '@/features/viewport/viewport'
import type { Point } from '@/features/viewport/viewport'
import { ZoomControl } from '@/features/viewport/zoom-control'

interface NavigatorPanelProps {
  documentId: string
}

const FULL = 1
const PERCENT = 100

/**
 * Photoshop's Navigator: the whole picture small, with a frame over the part
 * the canvas shows. Dragging the frame moves the canvas, clicking elsewhere
 * moves the frame there, and the zoom control below zooms. It reads and
 * changes the same view as the canvas, so each follows the other.
 */
export function NavigatorPanel({
  documentId,
}: NavigatorPanelProps): React.JSX.Element {
  const picture = useShownPicture(documentId)
  const view = useViewport(documentId)
  const surface = useRef<HTMLDivElement>(null)
  const grab = useRef<Point | null>(null)

  if (!picture) {
    return (
      <p role="status" className="p-3 text-body-md text-muted-foreground">
        There is no picture to navigate.
      </p>
    )
  }

  const { frame, viewport } = view
  const shown = frame ? visibleRect(viewport, frame) : undefined
  const left = shown ? Math.max(0, shown.x) : 0
  const top = shown ? Math.max(0, shown.y) : 0
  const right = shown ? Math.min(FULL, shown.x + shown.width) : FULL
  const bottom = shown ? Math.min(FULL, shown.y + shown.height) : FULL

  function pointOf(event: React.PointerEvent<HTMLElement>): Point | undefined {
    const box = surface.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return undefined
    return {
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLElement>): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const point = pointOf(event)
    if (!point) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const inside =
      point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
    grab.current = inside
      ? { x: point.x - viewport.x, y: point.y - viewport.y }
      : { x: 0, y: 0 }
    view.centreOn({
      x: point.x - grab.current.x,
      y: point.y - grab.current.y,
    })
  }

  function handlePointerMove(event: React.PointerEvent<HTMLElement>): void {
    const offset = grab.current
    const point = pointOf(event)
    if (!offset || !point) return
    view.centreOn({ x: point.x - offset.x, y: point.y - offset.y })
  }

  function handlePointerEnd(): void {
    grab.current = null
  }

  return (
    <div data-slot="navigator" className="flex flex-col gap-3 p-3">
      <div className="@container flex h-44 items-center justify-center">
        <div
          ref={surface}
          role="application"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the preview is a draggable surface with its own keys
          tabIndex={0}
          aria-label="Navigator preview"
          aria-description="Drag to move the canvas. The arrow, plus and minus keys move and zoom it, unless you changed them."
          data-slot="navigator-preview"
          className="relative aspect-(--ratio) w-[min(100cqw,calc(100cqh*var(--ratio)))] cursor-grab touch-none bg-checkerboard outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing"
          style={{ '--ratio': frame?.ratio ?? FULL } as React.CSSProperties}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          <img
            src={picture.url}
            alt={picture.name}
            draggable={false}
            className="pointer-events-none size-full object-contain select-none"
          />
          {shown ? (
            <div
              data-slot="navigator-view"
              aria-hidden="true"
              className="pointer-events-none absolute border border-destructive shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]"
              style={{
                left: `${left * PERCENT}%`,
                top: `${top * PERCENT}%`,
                width: `${(right - left) * PERCENT}%`,
                height: `${(bottom - top) * PERCENT}%`,
              }}
            />
          ) : null}
        </div>
      </div>
      <ZoomControl documentId={documentId} />
    </div>
  )
}
