import { ValidationError } from '../../src/server/errors.ts'

/**
 * A part of a picture, as fractions of its width and height so it means the
 * same part at any size: `x` and `y` are the top left corner and `width` and
 * `height` the extent, all from 0 to 1. This is the same measure the canvas's
 * view uses, so a region is the same thing whether the picture is the small
 * preview or one day the full-size image.
 */
export type Region = {
  x: number
  y: number
  width: number
  height: number
}

export type CropBox = {
  left: number
  top: number
  width: number
  height: number
}

const PARTS = 4
const TOLERANCE = 1e-9
const SHAPE =
  'Give four numbers: x,y,width,height, as fractions of the picture.'
const OUTSIDE =
  'The region must be inside the picture: x and y from 0, width and height more than 0, and x + width and y + height at most 1.'

export function parseRegion(text: string): Region {
  const parts = text.split(',').map((part) => part.trim())
  if (parts.length !== PARTS || parts.some((part) => part === '')) {
    throw new ValidationError(SHAPE)
  }
  const numbers = parts.map(Number)
  if (numbers.some((value) => !Number.isFinite(value))) {
    throw new ValidationError(`${SHAPE} These are not numbers.`)
  }
  const [x = 0, y = 0, width = 0, height = 0] = numbers
  const inside =
    x >= 0 &&
    y >= 0 &&
    width > 0 &&
    height > 0 &&
    x + width <= 1 + TOLERANCE &&
    y + height <= 1 + TOLERANCE
  if (!inside) throw new ValidationError(OUTSIDE)
  return { x, y, width, height }
}

/** The pixels of a picture `width` by `height` that a region touches: at least one, and never outside the picture. */
export function cropBox(
  region: Region,
  width: number,
  height: number,
): CropBox {
  const left = Math.min(width - 1, Math.floor(region.x * width + TOLERANCE))
  const top = Math.min(height - 1, Math.floor(region.y * height + TOLERANCE))
  const right = Math.min(
    width,
    Math.max(
      left + 1,
      Math.ceil((region.x + region.width) * width - TOLERANCE),
    ),
  )
  const bottom = Math.min(
    height,
    Math.max(
      top + 1,
      Math.ceil((region.y + region.height) * height - TOLERANCE),
    ),
  )
  return { left, top, width: right - left, height: bottom - top }
}
