/**
 * The maths of looking at a picture through a window: how far in, and which
 * part. Everything here is pure, so the canvas and the Navigator panel, which
 * show the same view, cannot disagree about it.
 *
 * `zoom` is screen pixels per picture pixel, as in any image editor: 1 is
 * 100%, where one pixel of the picture is one pixel on screen. It does not
 * follow the window or the picture, so a picture that an edit makes smaller
 * looks smaller, and fitting is a zoom like any other. `x` and `y` say which
 * point of the picture is in the middle of the window, as fractions of the
 * picture (0 is its left or top edge, 1 its right or bottom edge).
 */

export interface Viewport {
  zoom: number
  x: number
  y: number
}

/** The window, in CSS pixels, and the picture in it, in its own pixels, which is what a percentage is a percentage of. */
export interface ViewFrame {
  viewWidth: number
  viewHeight: number
  pictureWidth: number
  pictureHeight: number
}

export interface Point {
  x: number
  y: number
}

/** The part of the picture in the window, as fractions of the picture. */
export interface ViewRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ZoomLimits {
  min: number
  max: number
}

/** The most the picture can be magnified, as a percentage of its own pixels. */
export const MAX_PERCENT = 3200
/** The least the picture can be shown at, as a percentage of its own pixels. */
export const MIN_PERCENT = 1
/** One step of zooming in or out with a key or a button. */
export const ZOOM_STEP = 1.25
/** The percentage at which one picture pixel is one screen pixel. */
export const ACTUAL_SIZE_PERCENT = 100
/** The middle of the picture at 100%, which is all there is to show before the window is measured. */
export const ACTUAL_SIZE_VIEWPORT: Readonly<Viewport> = {
  zoom: 1,
  x: 0.5,
  y: 0.5,
}

const FULL = 1
const HALF = 0.5
const PERCENT = 100

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

/** The zoom at which the whole picture just fits in the window. */
export function fitZoom(frame: ViewFrame): number {
  const zoom = Math.min(
    frame.viewWidth / frame.pictureWidth,
    frame.viewHeight / frame.pictureHeight,
  )
  return Number.isFinite(zoom) && zoom > 0 ? zoom : FULL
}

/** The whole picture, as big as the window allows. */
export function fitViewport(frame: ViewFrame): Viewport {
  return { zoom: fitZoom(frame), x: HALF, y: HALF }
}

/** How a picture opens, as in an image editor: fitted when it is bigger than the window, at 100% when it is not, so it is never enlarged. */
export function initialViewport(frame: ViewFrame): Viewport {
  return { zoom: Math.min(FULL, fitZoom(frame)), x: HALF, y: HALF }
}

/** From the least percent to the most, always with room for fit. */
export function zoomLimits(frame: ViewFrame): ZoomLimits {
  const fit = fitZoom(frame)
  return {
    min: Math.min(MIN_PERCENT / PERCENT, fit),
    max: Math.max(MAX_PERCENT / PERCENT, fit),
  }
}

/** The zoom as a percentage of the picture's own pixels, as Photoshop shows it. */
export function percentOf(zoom: number): number {
  return zoom * PERCENT
}

/** Which zoom shows the picture at this percentage of its own pixels. */
export function zoomForPercent(percent: number): number {
  return percent / PERCENT
}

/** The picture's size on screen at this zoom, in CSS pixels. */
function shownSize(
  frame: ViewFrame,
  zoom: number,
): { width: number; height: number } {
  return {
    width: frame.pictureWidth * zoom,
    height: frame.pictureHeight * zoom,
  }
}

/** The part of the picture in the window. It is bigger than the picture while the picture is smaller than the window. */
export function visibleRect(viewport: Viewport, frame: ViewFrame): ViewRect {
  const shown = shownSize(frame, viewport.zoom)
  const width = frame.viewWidth / shown.width
  const height = frame.viewHeight / shown.height
  return {
    x: viewport.x - width * HALF,
    y: viewport.y - height * HALF,
    width,
    height,
  }
}

function clampCentre(centre: number, visible: number): number {
  if (visible >= FULL) return HALF
  return clamp(centre, visible * HALF, FULL - visible * HALF)
}

/** Keeps the zoom within its limits and the window over the picture, so the picture can never be dragged out of sight. */
export function clampViewport(viewport: Viewport, frame: ViewFrame): Viewport {
  const limits = zoomLimits(frame)
  const zoom = clamp(viewport.zoom, limits.min, limits.max)
  const rect = visibleRect({ ...viewport, zoom }, frame)
  return {
    zoom,
    x: clampCentre(viewport.x, rect.width),
    y: clampCentre(viewport.y, rect.height),
  }
}

/**
 * Zooms by `factor` while the point of the picture under `anchor` (in pixels
 * from the window's top left; the middle of the window when omitted) stays
 * where it is.
 */
export function zoomBy(
  viewport: Viewport,
  frame: ViewFrame,
  factor: number,
  anchor: Point = { x: frame.viewWidth * HALF, y: frame.viewHeight * HALF },
): Viewport {
  const limits = zoomLimits(frame)
  const zoom = clamp(viewport.zoom * factor, limits.min, limits.max)
  const offsetX = anchor.x - frame.viewWidth * HALF
  const offsetY = anchor.y - frame.viewHeight * HALF
  const before = shownSize(frame, viewport.zoom)
  const after = shownSize(frame, zoom)
  const under = {
    x: viewport.x + offsetX / before.width,
    y: viewport.y + offsetY / before.height,
  }
  return clampViewport(
    {
      zoom,
      x: under.x - offsetX / after.width,
      y: under.y - offsetY / after.height,
    },
    frame,
  )
}

/** Zooms to a percentage of the picture's own pixels, about the middle of the window. */
export function zoomToPercent(
  viewport: Viewport,
  frame: ViewFrame,
  percent: number,
): Viewport {
  return zoomBy(viewport, frame, zoomForPercent(percent) / viewport.zoom)
}

/** Moves the picture by this many screen pixels, as if it were dragged. */
export function panBy(
  viewport: Viewport,
  frame: ViewFrame,
  dx: number,
  dy: number,
): Viewport {
  const shown = shownSize(frame, viewport.zoom)
  return clampViewport(
    {
      ...viewport,
      x: viewport.x - dx / shown.width,
      y: viewport.y - dy / shown.height,
    },
    frame,
  )
}

/** Puts this point of the picture (as fractions of the picture) in the middle of the window. */
export function centreOn(
  viewport: Viewport,
  frame: ViewFrame,
  point: Point,
): Viewport {
  return clampViewport({ ...viewport, x: point.x, y: point.y }, frame)
}

/**
 * The zoom slider sits on a log scale, so each stretch of it multiplies the
 * zoom by the same amount, from the least (the left end) to the most (the right).
 */
export function positionForZoom(zoom: number, limits: ZoomLimits): number {
  if (limits.max <= limits.min) return 0
  return Math.log(zoom / limits.min) / Math.log(limits.max / limits.min)
}

export function zoomForPosition(position: number, limits: ZoomLimits): number {
  return limits.min * (limits.max / limits.min) ** clamp(position, 0, FULL)
}

/** Reads what was typed in the zoom field: "50", "50%" or "50 %". Undefined when it is not a positive number. */
export function parsePercent(text: string): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(text)
  if (!match?.[1]) return undefined
  const percent = Number(match[1])
  return percent > 0 ? percent : undefined
}

export function formatPercent(percent: number): string {
  return `${Math.max(1, Math.round(percent))}%`
}
