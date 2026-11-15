import { parseColour, toHex } from '@/features/workflows/fields/colour-value'
import type { Rgba } from '@/features/workflows/fields/colour-value'

export interface Rgb {
  r: number
  g: number
  b: number
}

/** Hue in degrees (0–360), saturation and value from 0 to 1. */
export interface Hsv {
  h: number
  s: number
  v: number
}

const BYTE_MAX = 255
const HUE_SECTOR = 60
const HUE_MAX = 360
const RADIX = 16

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const red = r / BYTE_MAX
  const green = g / BYTE_MAX
  const blue = b / BYTE_MAX
  const max = Math.max(red, green, blue)
  const delta = max - Math.min(red, green, blue)
  let hue = 0
  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6
    else if (max === green) hue = (blue - red) / delta + 2
    else hue = (red - green) / delta + 4
  }
  return {
    h: (hue * HUE_SECTOR + HUE_MAX) % HUE_MAX,
    s: max === 0 ? 0 : delta / max,
    v: max,
  }
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const chroma = v * s
  const sector = (((h % HUE_MAX) + HUE_MAX) % HUE_MAX) / HUE_SECTOR
  const second = chroma * (1 - Math.abs((sector % 2) - 1))
  const offset = v - chroma
  const parts: ReadonlyArray<readonly [number, number, number]> = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ]
  const [r, g, b] = parts[Math.min(Math.floor(sector), parts.length - 1)]
  const byte = (value: number): number =>
    Math.round((value + offset) * BYTE_MAX)
  return { r: byte(r), g: byte(g), b: byte(b) }
}

/** `#rrggbb` while opaque, `#rrggbbaa` once see-through. */
export function toHexAlpha(colour: Rgba): string {
  if (colour.alpha >= 1) return toHex(colour)
  const alpha = Math.round(colour.alpha * BYTE_MAX)
    .toString(RADIX)
    .padStart(2, '0')
  return `${toHex(colour)}${alpha}`
}

/** What a hex box holds: 3, 4, 6 or 8 digits, with or without the leading `#`. */
export function parseHexInput(text: string): Rgba | undefined {
  const trimmed = text.trim()
  return parseColour(trimmed.startsWith('#') ? trimmed : `#${trimmed}`)
}
