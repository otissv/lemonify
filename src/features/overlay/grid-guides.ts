import { z } from 'zod'

/** Lines drawn inside a box to help place it, like the overlays of an image editor's crop tool. */
export enum OverlayGuide {
  None = 'none',
  Thirds = 'thirds',
  Grid = 'grid',
  Diagonal = 'diagonal',
  Triangle = 'triangle',
  GoldenRatio = 'golden-ratio',
  GoldenSpiral = 'golden-spiral',
}

export const OVERLAY_GUIDE_LABELS: Readonly<Record<OverlayGuide, string>> = {
  [OverlayGuide.None]: 'None',
  [OverlayGuide.Thirds]: 'Rule of thirds',
  [OverlayGuide.Grid]: 'Grid',
  [OverlayGuide.Diagonal]: 'Diagonal',
  [OverlayGuide.Triangle]: 'Triangle',
  [OverlayGuide.GoldenRatio]: 'Golden ratio',
  [OverlayGuide.GoldenSpiral]: 'Golden spiral',
}

const overlayGuideSchema = z.enum(OverlayGuide)

/** A stored guide, or none when it is not one this version knows. */
export function parseOverlayGuide(value: unknown): OverlayGuide {
  const parsed = overlayGuideSchema.safeParse(value)
  return parsed.success ? parsed.data : OverlayGuide.None
}

export const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2

const GRID_DIVISIONS = 6
const SPIRAL_ARCS = 12
const DECIMALS = 4

function n(value: number): string {
  return String(Number(value.toFixed(DECIMALS)))
}

function across(
  fractions: ReadonlyArray<number>,
  w: number,
  h: number,
): string {
  let path = ''
  for (const fraction of fractions) path += `M${n(w * fraction)} 0V${n(h)}`
  for (const fraction of fractions) path += `M0 ${n(h * fraction)}H${n(w)}`
  return path
}

type Point = readonly [number, number]

function line(from: Point, to: Point): string {
  return `M${n(from[0])} ${n(from[1])}L${n(to[0])} ${n(to[1])}`
}

/** Where a line from `corner` at a right angle meets the line through `a` and `b`. */
function foot(corner: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const t =
    ((corner[0] - a[0]) * dx + (corner[1] - a[1]) * dy) / (dx * dx + dy * dy)
  return [a[0] + t * dx, a[1] + t * dy]
}

function diagonals(w: number, h: number): string {
  const topLeft: Point = [0, 0]
  const topRight: Point = [w, 0]
  const bottomLeft: Point = [0, h]
  const bottomRight: Point = [w, h]
  let path = line(topLeft, bottomRight) + line(topRight, bottomLeft)
  for (const corner of [topLeft, bottomRight]) {
    path += line(corner, foot(corner, topRight, bottomLeft))
  }
  for (const corner of [topRight, bottomLeft]) {
    path += line(corner, foot(corner, topLeft, bottomRight))
  }
  return path
}

function triangle(w: number, h: number): string {
  const bottomLeft: Point = [0, h]
  const topRight: Point = [w, 0]
  let path = line(bottomLeft, topRight)
  for (const corner of [
    [0, 0],
    [w, h],
  ] as const) {
    path += line(corner, foot(corner, bottomLeft, topRight))
  }
  return path
}

/**
 * Quarter arcs of a spiral through golden rectangles, fitted to any box: each
 * step cuts off a slab 1/φ of the rectangle's width or height, from the left,
 * top, right and bottom in turn, and draws the arc inside it.
 */
function spiral(w: number, h: number): string {
  let x = 0
  let y = 0
  let width = w
  let height = h
  let path = `M0 ${n(h)}`
  for (let arc = 0; arc < SPIRAL_ARCS; arc += 1) {
    const side = arc % 4
    if (side === 0) {
      const slab = width / GOLDEN_RATIO
      path += `A${n(slab)} ${n(height)} 0 0 1 ${n(x + slab)} ${n(y)}`
      x += slab
      width -= slab
    } else if (side === 1) {
      const slab = height / GOLDEN_RATIO
      path += `A${n(width)} ${n(slab)} 0 0 1 ${n(x + width)} ${n(y + slab)}`
      y += slab
      height -= slab
    } else if (side === 2) {
      const slab = width / GOLDEN_RATIO
      path += `A${n(slab)} ${n(height)} 0 0 1 ${n(x + width - slab)} ${n(y + height)}`
      width -= slab
    } else {
      const slab = height / GOLDEN_RATIO
      path += `A${n(width)} ${n(slab)} 0 0 1 ${n(x)} ${n(y + height - slab)}`
      height -= slab
    }
  }
  return path
}

/** SVG path data of the guide in a box `w` wide and `h` high, with its corner at the origin. Empty for none. */
export function guidePath(guide: OverlayGuide, w: number, h: number): string {
  switch (guide) {
    case OverlayGuide.None:
      return ''
    case OverlayGuide.Thirds:
      return across([1 / 3, 2 / 3], w, h)
    case OverlayGuide.Grid: {
      const fractions: number[] = []
      for (let i = 1; i < GRID_DIVISIONS; i += 1) {
        fractions.push(i / GRID_DIVISIONS)
      }
      return across(fractions, w, h)
    }
    case OverlayGuide.GoldenRatio:
      return across([1 / GOLDEN_RATIO ** 2, 1 / GOLDEN_RATIO], w, h)
    case OverlayGuide.Diagonal:
      return diagonals(w, h)
    case OverlayGuide.Triangle:
      return triangle(w, h)
    case OverlayGuide.GoldenSpiral:
      return spiral(w, h)
  }
}
