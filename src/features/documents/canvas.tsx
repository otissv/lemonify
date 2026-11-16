import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useViewport } from '@/features/viewport/use-viewport'
import { useViewportGestures } from '@/features/viewport/use-viewport-gestures'
import { fitSize } from '@/features/viewport/viewport'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'

interface CanvasProps {
  id: string
  url: string
  name: string
  /** The size of the canvas image, used until the picture itself has loaded. */
  width: number
  height: number
}

interface Shown {
  url: string
  ratio: number
  /** The picture's width in its own pixels. */
  naturalWidth: number
  /** The picture has loaded, so nothing transparent is mistaken for it still arriving. */
  loaded: boolean
}

interface Size {
  width: number
  height: number
}

/** From this percentage of the picture's own pixels, pixels are shown as squares instead of smoothed. */
const PIXEL_PERCENT = 400

function measure(element: HTMLElement): Size {
  const box = element.getBoundingClientRect()
  return { width: box.width, height: box.height }
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
 * for part of it. The picture can be any size, since edits change it, so the
 * box takes its shape from the loaded picture. When a new render arrives the
 * old picture stays until the new one has loaded, so the checkerboard never
 * flashes between renders.
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
}: CanvasProps): React.JSX.Element {
  const [shown, setShown] = useState<Shown>({
    url,
    ratio: width / height,
    naturalWidth: width,
    loaded: false,
  })
  const windowRef = useRef<HTMLDivElement>(null)
  const size = useElementSize(windowRef)
  const gestures = useViewportGestures(windowRef, id)
  const setViewFrame = useAppStore((state) => state.setViewFrame)
  const { viewport, frame, percent } = useViewport(id)

  useEffect(() => {
    if (size.width === 0 || size.height === 0) return
    setViewFrame(id, {
      viewWidth: size.width,
      viewHeight: size.height,
      ratio: shown.ratio,
      naturalWidth: shown.naturalWidth,
    })
  }, [
    id,
    size.width,
    size.height,
    shown.ratio,
    shown.naturalWidth,
    setViewFrame,
  ])

  useEffect(() => {
    if (url === shown.url) return
    const next = new Image()
    next.onload = () => {
      const { naturalWidth, naturalHeight } = next
      const known = naturalWidth > 0 && naturalHeight > 0
      setShown({
        url,
        ratio: known ? naturalWidth / naturalHeight : width / height,
        naturalWidth: known ? naturalWidth : width,
        loaded: true,
      })
    }
    next.src = url
    return () => {
      next.onload = null
    }
  }, [url, shown.url, width, height])

  function handleLoad(event: React.SyntheticEvent<HTMLImageElement>): void {
    const { naturalWidth, naturalHeight } = event.currentTarget
    const known = naturalWidth > 0 && naturalHeight > 0
    setShown((current) => ({
      ...current,
      ratio: known ? naturalWidth / naturalHeight : current.ratio,
      naturalWidth: known ? naturalWidth : current.naturalWidth,
      loaded: true,
    }))
  }

  const fit = frame ? fitSize(frame) : undefined
  const transform = fit
    ? `translate(${(0.5 - viewport.x) * viewport.zoom * fit.width}px, ${(0.5 - viewport.y) * viewport.zoom * fit.height}px) scale(${viewport.zoom})`
    : undefined
  const zoomedIn = viewport.zoom > 1
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
          '@container flex size-full touch-none items-center justify-center overflow-hidden outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset',
          zoomedIn && 'cursor-grab active:cursor-grabbing',
        )}
        {...gestures}
      >
        <div
          data-slot="canvas"
          className={cn(
            'aspect-(--ratio) w-[min(100cqw,calc(100cqh*var(--ratio)))] shrink-0',
            shown.loaded && 'bg-checkerboard',
          )}
          style={{ '--ratio': shown.ratio, transform } as React.CSSProperties}
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
        </div>
      </div>
    </div>
  )
}
