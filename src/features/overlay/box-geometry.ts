export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export interface Delta {
  x: number
  y: number
}

/** Which part of a box is dragged: the whole box, one edge or one corner (named by compass point). */
export type BoxHandle =
  | 'move'
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw'

export interface DragModifiers {
  /** Keep the width over height the box started with. */
  keepAspect: boolean
  /** Resize about the middle instead of the opposite edge. */
  fromCentre: boolean
}

/** The smallest box, in image pixels: what the `extract` schema accepts. */
export const MIN_BOX_SIZE = 1

type Axis = 'start' | 'end' | 'none'

/** Which side of an axis the handle drags: the start (west, north), the end (east, south) or neither. */
function sideOf(handle: BoxHandle, startKey: string, endKey: string): Axis {
  if (handle === 'move') return 'none'
  if (handle.includes(startKey)) return 'start'
  if (handle.includes(endKey)) return 'end'
  return 'none'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Where a box dragged by `delta` (image pixels) ends up, kept inside the picture, whole pixels and at least one pixel across. */
export function dragBox(
  start: Box,
  handle: BoxHandle,
  delta: Delta,
  bounds: Size,
  modifiers: DragModifiers,
): Box {
  if (handle === 'move') return nudgeBox(start, delta.x, delta.y, bounds)
  const horizontal = sideOf(handle, 'w', 'e')
  const vertical = sideOf(handle, 'n', 's')
  const growth = modifiers.fromCentre ? 2 : 1
  let width = start.width + sign(horizontal) * delta.x * growth
  let height = start.height + sign(vertical) * delta.y * growth
  if (modifiers.keepAspect) {
    ;({ width, height } = withAspect(
      start,
      horizontal,
      vertical,
      width,
      height,
    ))
  }
  const room = {
    width: roomOn(start.left, start.width, bounds.width, horizontal, modifiers),
    height: roomOn(start.top, start.height, bounds.height, vertical, modifiers),
  }
  ;({ width, height } = fitted(width, height, room, modifiers.keepAspect))
  return {
    left: placed(
      start.left,
      start.width,
      width,
      bounds.width,
      horizontal,
      modifiers,
    ),
    top: placed(
      start.top,
      start.height,
      height,
      bounds.height,
      vertical,
      modifiers,
    ),
    width,
    height,
  }
}

function sign(side: Axis): number {
  if (side === 'start') return -1
  return side === 'end' ? 1 : 0
}

function withAspect(
  start: Box,
  horizontal: Axis,
  vertical: Axis,
  width: number,
  height: number,
): Size {
  const ratio = start.width / start.height
  if (horizontal === 'none') return { width: height * ratio, height }
  if (vertical === 'none') return { width, height: width / ratio }
  const widthChange = Math.abs(width / start.width - 1)
  const heightChange = Math.abs(height / start.height - 1)
  return widthChange >= heightChange
    ? { width, height: width / ratio }
    : { width: height * ratio, height }
}

/** The most a side can grow to along one axis: up to the picture's edge on the dragged side, or twice the nearer gap from the middle. */
function roomOn(
  origin: number,
  length: number,
  limit: number,
  side: Axis,
  modifiers: DragModifiers,
): number {
  const middle = origin + length / 2
  const aboutMiddle = 2 * Math.min(middle, limit - middle)
  if (modifiers.fromCentre || side === 'none') return aboutMiddle
  return side === 'start' ? origin + length : limit - origin
}

function fitted(
  width: number,
  height: number,
  room: Size,
  keepAspect: boolean,
): Size {
  if (keepAspect) {
    const shrink = Math.min(1, room.width / width, room.height / height)
    const grow = Math.max(1, MIN_BOX_SIZE / width, MIN_BOX_SIZE / height)
    const factor = shrink < 1 ? shrink : grow
    return {
      width: clamp(
        Math.round(width * factor),
        MIN_BOX_SIZE,
        Math.floor(room.width),
      ),
      height: clamp(
        Math.round(height * factor),
        MIN_BOX_SIZE,
        Math.floor(room.height),
      ),
    }
  }
  return {
    width: clamp(Math.round(width), MIN_BOX_SIZE, Math.floor(room.width)),
    height: clamp(Math.round(height), MIN_BOX_SIZE, Math.floor(room.height)),
  }
}

function placed(
  origin: number,
  length: number,
  next: number,
  limit: number,
  side: Axis,
  modifiers: DragModifiers,
): number {
  if (!modifiers.fromCentre && side === 'start') return origin + length - next
  if (!modifiers.fromCentre && side === 'end') return origin
  const middle = origin + length / 2
  return clamp(Math.round(middle - next / 2), 0, limit - next)
}

/** The box moved by a number of image pixels, kept inside the picture at its own size. */
export function nudgeBox(box: Box, dx: number, dy: number, bounds: Size): Box {
  return {
    ...box,
    left: clamp(Math.round(box.left + dx), 0, bounds.width - box.width),
    top: clamp(Math.round(box.top + dy), 0, bounds.height - box.height),
  }
}

/** A box made to fit the picture: whole pixels, at least one across, wholly inside. For a box that was saved for a picture of another size. */
export function clampBox(box: Box, bounds: Size): Box {
  const left = clamp(Math.round(box.left), 0, bounds.width - MIN_BOX_SIZE)
  const top = clamp(Math.round(box.top), 0, bounds.height - MIN_BOX_SIZE)
  return {
    left,
    top,
    width: clamp(Math.round(box.width), MIN_BOX_SIZE, bounds.width - left),
    height: clamp(Math.round(box.height), MIN_BOX_SIZE, bounds.height - top),
  }
}

export function sameBox(a: Box, b: Box): boolean {
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  )
}
