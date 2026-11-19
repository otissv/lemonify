import { describe, expect, it } from 'vitest'

import {
  GOLDEN_RATIO,
  OverlayGuide,
  guidePath,
  parseOverlayGuide,
} from '@/features/overlay/grid-guides'

const W = 300
const H = 200

function numbers(path: string): number[] {
  return [...path.matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)].map(Number)
}

function commands(path: string, letter: string): number {
  return path.split(letter).length - 1
}

describe('guidePath', () => {
  it('draws nothing for none', () => {
    expect(guidePath(OverlayGuide.None, W, H)).toBe('')
  })

  it('divides the box in thirds, two lines each way', () => {
    const path = guidePath(OverlayGuide.Thirds, W, H)
    expect(commands(path, 'M')).toBe(4)
    expect(path).toContain('M100 0V200')
    expect(path).toContain('M0 133.3333')
  })

  it('draws a grid of even squares-ish cells, five lines each way', () => {
    expect(commands(guidePath(OverlayGuide.Grid, W, H), 'M')).toBe(10)
  })

  it('places the golden ratio lines at 38.2% and 61.8%', () => {
    const path = guidePath(OverlayGuide.GoldenRatio, W, H)
    expect(commands(path, 'M')).toBe(4)
    expect(path).toContain(`M${(W / GOLDEN_RATIO ** 2).toFixed(4)} 0`)
    expect(path).toContain(`M${(W / GOLDEN_RATIO).toFixed(4)} 0`)
  })

  it('draws both diagonals and the lines that meet them at right angles', () => {
    const path = guidePath(OverlayGuide.Diagonal, W, H)
    expect(commands(path, 'M')).toBe(6)
    expect(path).toContain('M0 0L300 200')
    expect(path).toContain('M300 0L0 200')
  })

  it('draws one diagonal and the lines from the other corners that meet it at right angles', () => {
    const path = guidePath(OverlayGuide.Triangle, W, H)
    expect(commands(path, 'M')).toBe(3)
    expect(path).toContain('M0 200L300 0')
    const [from, to] = [
      numbers((path.split('M')[2] ?? '').split('L')[0] ?? ''),
      numbers((path.split('M')[2] ?? '').split('L')[1] ?? ''),
    ]
    const [cx = 0, cy = 0] = from
    const [fx = 0, fy = 0] = to
    expect(fx / W + fy / H).toBeCloseTo(1, 3)
    expect((fx - cx) * W + (fy - cy) * -H).toBeCloseTo(0, 1)
  })

  it('draws a spiral of quarter arcs that stays inside the box', () => {
    const path = guidePath(OverlayGuide.GoldenSpiral, W, H)
    expect(path.startsWith('M0 200')).toBe(true)
    expect(commands(path, 'A')).toBeGreaterThanOrEqual(8)
    for (const value of numbers(path)) {
      expect(value).toBeGreaterThanOrEqual(-0.001)
      expect(value).toBeLessThanOrEqual(W + 0.001)
    }
  })
})

describe('parseOverlayGuide', () => {
  it('keeps a known guide and turns anything else into none', () => {
    expect(parseOverlayGuide('thirds')).toBe(OverlayGuide.Thirds)
    expect(parseOverlayGuide('sparkles')).toBe(OverlayGuide.None)
    expect(parseOverlayGuide(undefined)).toBe(OverlayGuide.None)
  })
})
