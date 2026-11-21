import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useViewport } from '@/features/viewport/use-viewport'
import { useViewportGestures } from '@/features/viewport/use-viewport-gestures'
import { visibleRect } from '@/features/viewport/viewport'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/ui-store'

interface CanvasProps {
  id: string
  url: string
  name: string
  /** The picture's size in its own pixels, which a preview shrunk to be shown does not have, so 100% is one of these pixels to one screen pixel. */
  width: number
  height: number
  /** Drawn on the picture, moving and zooming with it; shown only while the picture is the one it was made for. */
  overlay?: React.ReactNode
}

interface Shown {
  url: string
  /** The picture's size in its own pixels. */
  width: number
  height: number
  /** The picture has loaded, so nothing transparent is mistaken for it still arriving. */
  loaded: boolean
}

interface Size {
  width: number
  height: number
}

/** From this percentage of the picture's own pixels, pixels are shown as squares instead of smoothed. */
const PIXEL_PERCENT = 400

function pixels(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** The room inside an element's padding, which is where the picture is fitted, so the handles of an overlay on its edge are not cut off. */
function measure(element: HTMLElement): Size {
  const box = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  return {
    width: box.width - pixels(style.paddingLeft) - pixels(style.paddingRight),
    height: box.height - pixels(style.paddingTop) - pixels(style.paddingBottom),
  }
}

/** The size of an element, kept up to date as the window or the layout changes. */
function useElementSize(ref: React.RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const update = (): void => {
      const next = measure(element)
      setSize((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      )
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [ref])
  return size
}

/**
 * The picture on a checkerboard that is exactly as big as the picture, so
 * transparency shows against it and nothing around the picture is mistaken
 * for part of it. The box is laid out at the picture's own size in pixels and
 * scaled by the zoom, as in an image editor: at 100% one pixel of the picture
 * is one pixel on screen, and since the zoom stays put when an edit changes
 * the picture's size, a smaller picture looks smaller. When a new render
 * arrives the old picture, at its own size, stays until the new one has
 * loaded, so the checkerboard never flashes between renders.
 *
 * It can be zoomed in and moved around, by wheel, drag, pinch, keys, or the
 * zoom control and Navigator panel, which all change one view per document.
 * Zooming scales the box about its middle and moves it, so the picture is
 * never loaded or laid out again.
 */
export function Canvas({
  id,
  url,
  name,
  width,
  height,
  overlay,
}: CanvasProps): React.JSX.Element {
  const [shown, setShown] = useState<Shown>({
    url,
    width,
    height,
    loaded: false,
  })
  const windowRef = useRef<HTMLDivElement>(null)
  const size = useElementSize(windowRef)
  const gestures = useViewportGestures(windowRef, id)
  const setViewFrame = useUiStore((state) => state.setViewFrame)
  const { viewport, frame, percent } = useViewport(id)

  useEffect(() => {
    if (size.width === 0 || size.height === 0) return
    setViewFrame(id, {
      viewWidth: size.width,
      viewHeight: size.height,
      pictureWidth: shown.width,
      pictureHeight: shown.height,
    })
  }, [id, size.width, size.height, shown.width, shown.height, setViewFrame])

  useEffect(() => {
    if (url === shown.url) {
      if (width === shown.width && height === shown.height) return
      setShown((current) => ({ ...current, width, height }))
      return
    }
    const next = new Image()
    next.onload = () => {
      setShown({ url, width, height, loaded: true })
    }
    next.src = url
    return () => {
      next.onload = null
    }
  }, [url, shown.url, shown.width, shown.height, width, height])

  function handleLoad(): void {
    setShown((current) => ({ ...current, loaded: true }))
  }

  const transform = frame
    ? `translate(${(0.5 - viewport.x) * viewport.zoom * shown.width}px, ${(0.5 - viewport.y) * viewport.zoom * shown.height}px) scale(${viewport.zoom})`
    : undefined
  const visible = frame ? visibleRect(viewport, frame) : undefined
  const movable =
    visible !== undefined && (visible.width < 1 || visible.height < 1)
  const pixelated =
    percent !== undefined && percent >= PIXEL_PERCENT && shown.loaded

  return (
    <div className="relative size-full">
      <div
        ref={windowRef}
        role="application"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the canvas is a pannable surface with its own keys
        tabIndex={0}
        aria-label="Canvas"
        aria-description="Scroll to move the picture, Ctrl or Cmd and scroll to zoom. Plus and minus zoom, zero fits, one shows actual size, arrow keys move."
        data-slot="canvas-window"
        className={cn(
          '@container flex size-full touch-none p-2 items-center justify-center overflow-hidden outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset',
          movable && 'cursor-grab active:cursor-grabbing',
        )}
        {...gestures}
      >
        <div
          data-slot="canvas"
          className={cn('relative shrink-0', shown.loaded && 'bg-checkerboard')}
          style={{ width: shown.width, height: shown.height, transform }}
        >
          <img
            src={shown.url}
            alt={name}
            draggable={false}
            className={cn(
              'size-full object-contain select-none',
              pixelated && '[image-rendering:pixelated]',
            )}
            onLoad={handleLoad}
          />
          {shown.url === url && shown.loaded && overlay}
        </div>
      </div>
    </div>
  )
}
