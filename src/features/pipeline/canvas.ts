import { z } from 'zod'

/** The longest side a canvas can have, the most Sharp can encode. */
export const MAX_CANVAS_SIDE = 65_535
/** The most pixels a canvas can hold: the limit Sharp puts on any image it reads, so an image that can be opened can be a canvas. */
export const MAX_CANVAS_PIXELS = 268_402_689

export const TRANSPARENT = 'transparent'

const backgroundSchema = z.union([
  z.literal(TRANSPARENT),
  z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #ff8000, or transparent.')
    .transform((colour) => colour.toLowerCase()),
])

const sideSchema = z.number().int().min(1).max(MAX_CANVAS_SIDE)

/**
 * The picture a Pipeline's steps are drawn on: its size and what is behind
 * everything. It is part of the Pipeline, so it is saved, undone and copied
 * with it, and nothing works it out from an image after the Pipeline is made.
 */
export const canvasSchema = z
  .strictObject({
    width: sideSchema,
    height: sideSchema,
    background: backgroundSchema.default(TRANSPARENT),
  })
  .refine(({ width, height }) => width * height <= MAX_CANVAS_PIXELS, {
    message: `A canvas can have at most ${MAX_CANVAS_PIXELS} pixels.`,
  })

export type Canvas = z.output<typeof canvasSchema>

/** A transparent canvas of this size; throws when the size is not a valid canvas. */
export function canvasOfSize(width: number, height: number): Canvas {
  return canvasSchema.parse({ width, height })
}

/** The canvas as render keys see it: equal text means equal pixels. */
export function canvasIdentity(canvas: Canvas): string {
  return `canvas:${canvas.width}x${canvas.height}:${canvas.background}`
}

export type BackgroundColour = {
  r: number
  g: number
  b: number
  alpha: number
}

const HEX_RADIX = 16
const HEX_DIGITS = 2

/** The background as the colour Sharp fills the canvas with. */
export function parseBackground(
  background: Canvas['background'],
): BackgroundColour {
  if (background === TRANSPARENT) return { r: 0, g: 0, b: 0, alpha: 0 }
  const channel = (start: number): number =>
    Number.parseInt(background.slice(start, start + HEX_DIGITS), HEX_RADIX)
  return { r: channel(1), g: channel(3), b: channel(5), alpha: 1 }
}
