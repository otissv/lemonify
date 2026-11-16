import type { LayerAnchor, LayerFit } from '@/features/pipeline/layer'

export interface Size {
  width: number
  height: number
}

export interface Point {
  left: number
  top: number
}

export interface Region extends Point, Size {}

const PERCENT = 100

function whole(value: number): number {
  return Math.max(1, Math.round(value))
}

/** The size a layer's image is drawn at: sized by `fit` against the canvas, then multiplied by `scale` (a percentage). */
export function layerSize(
  canvas: Size,
  image: Size,
  fit: LayerFit,
  scale: number,
): Size {
  const factor = scale / PERCENT
  const across = canvas.width / image.width
  const down = canvas.height / image.height
  switch (fit) {
    case 'original':
      return {
        width: whole(image.width * factor),
        height: whole(image.height * factor),
      }
    case 'stretch':
      return {
        width: whole(canvas.width * factor),
        height: whole(canvas.height * factor),
      }
    case 'contain': {
      const ratio = Math.min(across, down) * factor
      return {
        width: whole(image.width * ratio),
        height: whole(image.height * ratio),
      }
    }
    case 'cover': {
      const ratio = Math.max(across, down) * factor
      return {
        width: whole(image.width * ratio),
        height: whole(image.height * ratio),
      }
    }
    case 'inside': {
      const ratio = Math.min(1, across, down) * factor
      return {
        width: whole(image.width * ratio),
        height: whole(image.height * ratio),
      }
    }
  }
}

function along(space: number, placed: number, edge: -1 | 0 | 1): number {
  if (edge === -1) return 0
  if (edge === 1) return space - placed
  return Math.floor((space - placed) / 2)
}

const ANCHORS: Record<LayerAnchor, { across: -1 | 0 | 1; down: -1 | 0 | 1 }> = {
  northwest: { across: -1, down: -1 },
  north: { across: 0, down: -1 },
  northeast: { across: 1, down: -1 },
  west: { across: -1, down: 0 },
  centre: { across: 0, down: 0 },
  east: { across: 1, down: 0 },
  southwest: { across: -1, down: 1 },
  south: { across: 0, down: 1 },
  southeast: { across: 1, down: 1 },
}

/** Where the layer's top left corner lands on the canvas: against the anchor, then moved by `x` and `y`. May be off the canvas. */
export function layerPlacement(
  canvas: Size,
  placed: Size,
  anchor: LayerAnchor,
  x: number,
  y: number,
): Point {
  const edge = ANCHORS[anchor]
  return {
    left: along(canvas.width, placed.width, edge.across) + x,
    top: along(canvas.height, placed.height, edge.down) + y,
  }
}

/**
 * The part of a layer that is over the canvas: which part of the layer to
 * keep (`crop`) and where on the canvas it goes (`at`). Undefined when none of
 * it is over the canvas.
 */
export function visibleRegion(
  canvas: Size,
  placed: Size,
  left: number,
  top: number,
): { crop: Region; at: Point } | undefined {
  const from = { left: Math.max(left, 0), top: Math.max(top, 0) }
  const to = {
    left: Math.min(left + placed.width, canvas.width),
    top: Math.min(top + placed.height, canvas.height),
  }
  const width = to.left - from.left
  const height = to.top - from.top
  if (width <= 0 || height <= 0) return undefined
  return {
    crop: { left: from.left - left, top: from.top - top, width, height },
    at: from,
  }
}
