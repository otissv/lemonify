import { z } from 'zod'

export interface Rgba {
  r: number
  g: number
  b: number
  alpha: number
}

const BYTE_MAX = 255
const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RADIX = 16

const ObjectColourSchema = z.object({
  r: z.number(),
  g: z.number(),
  b: z.number(),
  alpha: z.number().optional(),
})

function expand(digits: string): string {
  return digits.length <= 4
    ? [...digits].map((digit) => digit + digit).join('')
    : digits
}

/** A hex colour (`#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`) as numbers; undefined for anything else. */
export function parseHex(text: string): Rgba | undefined {
  const match = HEX.exec(text.trim())
  if (!match) return undefined
  const digits = expand(match[1])
  const byte = (index: number): number =>
    Number.parseInt(digits.slice(index, index + 2), RADIX)
  return {
    r: byte(0),
    g: byte(2),
    b: byte(4),
    alpha: digits.length === 8 ? byte(6) / BYTE_MAX : 1,
  }
}

/** A hex colour or an `{r, g, b, alpha}` object as numbers; undefined for anything else, such as a colour name. */
export function parseColour(value: unknown): Rgba | undefined {
  if (typeof value === 'string') return parseHex(value)
  const object = ObjectColourSchema.safeParse(value)
  if (!object.success) return undefined
  const { r, g, b, alpha = 1 } = object.data
  return { r, g, b, alpha }
}

function hexByte(value: number): string {
  return Math.round(value).toString(RADIX).padStart(2, '0')
}

/** The colour without its opacity, as `#rrggbb`. */
export function toHex({ r, g, b }: Rgba): string {
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`
}

/** A hex string while opaque, `{r, g, b, alpha}` once see-through, as Sharp accepts both. */
export function formatColour(colour: Rgba): string | Record<string, number> {
  if (colour.alpha >= 1) return toHex(colour)
  const { r, g, b, alpha } = colour
  return { r, g, b, alpha }
}

/** The colour as `#rrggbb`, or `#rrggbbaa` when it is see-through. */
export function formatHex(colour: Rgba): string {
  if (colour.alpha >= 1) return toHex(colour)
  return `${toHex(colour)}${hexByte(colour.alpha * BYTE_MAX)}`
}
