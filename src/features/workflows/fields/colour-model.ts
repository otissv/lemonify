export interface Rgb {
  r: number
  g: number
  b: number
}

/** Hue in degrees (0–360), saturation and brightness from 0 to 1. */
export interface Hsv {
  h: number
  s: number
  v: number
}

const BYTE_MAX = 255
const HUE_SECTOR = 60
const FULL_TURN = 360

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
    hue = (hue * HUE_SECTOR + FULL_TURN) % FULL_TURN
  }
  return { h: hue, s: max === 0 ? 0 : delta / max, v: max }
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hue = ((h % FULL_TURN) + FULL_TURN) % FULL_TURN
  const chroma = v * s
  const sector = hue / HUE_SECTOR
  const second = chroma * (1 - Math.abs((sector % 2) - 1))
  const base = v - chroma
  const parts: Array<[number, number, number]> = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ]
  const [r, g, b] = parts[Math.floor(sector)] ?? parts[0]
  return {
    r: Math.round((r + base) * BYTE_MAX),
    g: Math.round((g + base) * BYTE_MAX),
    b: Math.round((b + base) * BYTE_MAX),
  }
}
