import { useMemo } from 'react'

import {
  ACTUAL_SIZE_PERCENT,
  centreOn,
  clampViewport,
  ACTUAL_SIZE_VIEWPORT,
  fitViewport,
  initialViewport,
  panBy,
  percentOf,
  zoomBy,
  zoomForPercent,
  zoomForPosition,
  zoomLimits,
  zoomToPercent,
  ZOOM_STEP,
} from '@/features/viewport/viewport'
import type {
  Point,
  ViewFrame,
  Viewport,
  ZoomLimits,
} from '@/features/viewport/viewport'
import { useUiStore } from '@/store/ui-store'

/** What the canvas and the Navigator can do to the view of a document, shared so they do the same thing. */
export interface ViewportActions {
  /** Zooms by a factor, keeping the point under `anchor` (pixels from the window's top left) where it is. */
  zoomBy: (factor: number, anchor?: Point) => void
  zoomIn: () => void
  zoomOut: () => void
  zoomToPercent: (percent: number) => void
  /** Zooms to where the slider is, from 0 (the least) to 1 (the most). */
  zoomToPosition: (position: number) => void
  fit: () => void
  /** One picture pixel to one screen pixel. */
  actualSize: () => void
  /** Fit when already at actual size, otherwise actual size, about `anchor`. */
  toggleActualSize: (anchor?: Point) => void
  /** Moves the picture by screen pixels, as if dragged. */
  panBy: (dx: number, dy: number) => void
  /** Puts a point of the picture, as fractions of it, in the middle of the window. */
  centreOn: (point: Point) => void
}

export interface DocumentViewport extends ViewportActions {
  /** Undefined until the canvas has measured itself. */
  frame: ViewFrame | undefined
  viewport: Viewport
  limits: ZoomLimits | undefined
  /** The zoom as a percentage of the picture's own pixels. */
  percent: number | undefined
}

const NEAR = 0.5

type Change = (viewport: Viewport, frame: ViewFrame) => Viewport

function change(documentId: string, update: Change): void {
  const state = useUiStore.getState()
  const frame = state.viewFrames[documentId]
  if (!frame) return
  const current = clampViewport(
    state.viewports[documentId] ?? initialViewport(frame),
    frame,
  )
  const next = update(current, frame)
  if (
    next.zoom === current.zoom &&
    next.x === current.x &&
    next.y === current.y
  ) {
    return
  }
  state.setViewport(documentId, next)
}

/** What changes the view of a document, built on the store alone so keys and gestures reach it the same way. */
export function viewportActionsFor(documentId: string): ViewportActions {
  const zoom = (factor: number, anchor?: Point): void => {
    change(documentId, (viewport, frame) =>
      zoomBy(viewport, frame, factor, anchor),
    )
  }
  const toPercent = (percent: number): void => {
    change(documentId, (viewport, frame) =>
      zoomToPercent(viewport, frame, percent),
    )
  }
  return {
    zoomBy: zoom,
    zoomIn: () => {
      zoom(ZOOM_STEP)
    },
    zoomOut: () => {
      zoom(1 / ZOOM_STEP)
    },
    zoomToPercent: toPercent,
    zoomToPosition: (position) => {
      change(documentId, (viewport, frame) =>
        zoomBy(
          viewport,
          frame,
          zoomForPosition(position, zoomLimits(frame)) / viewport.zoom,
        ),
      )
    },
    fit: () => {
      change(documentId, (_viewport, frame) => fitViewport(frame))
    },
    actualSize: () => {
      toPercent(ACTUAL_SIZE_PERCENT)
    },
    toggleActualSize: (anchor) => {
      change(documentId, (viewport, frame) => {
        if (Math.abs(percentOf(viewport.zoom) - ACTUAL_SIZE_PERCENT) < NEAR) {
          return fitViewport(frame)
        }
        const factor = zoomForPercent(ACTUAL_SIZE_PERCENT) / viewport.zoom
        return zoomBy(viewport, frame, factor, anchor)
      })
    },
    panBy: (dx, dy) => {
      change(documentId, (viewport, frame) => panBy(viewport, frame, dx, dy))
    },
    centreOn: (point) => {
      change(documentId, (viewport, frame) => centreOn(viewport, frame, point))
    },
  }
}

/** The actions alone, which do not change, so a gesture does not render again for each move of the pointer. */
export function useViewportActions(documentId: string): ViewportActions {
  return useMemo(() => viewportActionsFor(documentId), [documentId])
}

/** The view of a document, kept inside what its window allows, with the actions that change it. */
export function useViewport(documentId: string): DocumentViewport {
  const frame = useUiStore((state) => state.viewFrames[documentId])
  const stored = useUiStore((state) => state.viewports[documentId])
  const actions = useViewportActions(documentId)

  return useMemo(() => {
    const viewport = frame
      ? clampViewport(stored ?? initialViewport(frame), frame)
      : ACTUAL_SIZE_VIEWPORT
    return {
      ...actions,
      frame,
      viewport,
      limits: frame ? zoomLimits(frame) : undefined,
      percent: frame ? percentOf(viewport.zoom) : undefined,
    }
  }, [actions, frame, stored])
}
