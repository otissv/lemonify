// @vitest-environment node
import sharp from 'sharp'
import type { Sharp } from 'sharp'
import { describe, expect, it } from 'vitest'

import { applySharpOpsBlended } from './blend-tint.ts'
import { SharpOperationError } from './errors.ts'
import { SHARP_OP_CATEGORIES, applySharpOp, sharpOpSchema } from './ops.ts'
import type { SharpOp } from './ops.ts'

function solid(width: number, height: number, alpha = 1): Sharp {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 200, g: 100, b: 50, alpha },
    },
  })
}

async function render(
  image: Sharp,
  ops: SharpOp[],
): Promise<{ width: number; height: number; pixel: number[] }> {
  const done = await applySharpOpsBlended(image, ops, 'pixels')
  const { data, info } = await done
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    width: info.width,
    height: info.height,
    pixel: [...data.subarray(0, 4)],
  }
}

const scale = (percent: number, verticalPercent?: number): SharpOp =>
  sharpOpSchema.parse({ op: 'scale', percent, verticalPercent })
const opacity = (percent: number): SharpOp =>
  sharpOpSchema.parse({ op: 'opacity', percent })

describe('scale', () => {
  it('is a geometry tool, and opacity is a colour tool', () => {
    expect(SHARP_OP_CATEGORIES.geometry).toContain('scale')
    expect(SHARP_OP_CATEGORIES.colour).toContain('opacity')
  })

  it('shrinks and enlarges by a percentage of the picture as it is', async () => {
    expect(await render(solid(40, 20), [scale(50)])).toMatchObject({
      width: 20,
      height: 10,
    })
    expect(await render(solid(40, 20), [scale(250)])).toMatchObject({
      width: 100,
      height: 50,
    })
  })

  it('scales each way separately when asked', async () => {
    expect(await render(solid(40, 20), [scale(50, 200)])).toMatchObject({
      width: 20,
      height: 40,
    })
  })

  it('works on the size the steps before it left, and the steps after it on the new size', async () => {
    const rotated = sharpOpSchema.parse({ op: 'rotate', angle: 90 })

    const result = await render(solid(40, 20), [rotated, scale(50)])

    expect(result).toMatchObject({ width: 10, height: 20 })
  })

  it('never makes a side smaller than one pixel', async () => {
    expect(await render(solid(10, 3), [scale(1)])).toMatchObject({
      width: 1,
      height: 1,
    })
  })

  it('accepts only 1 to 1000 percent', () => {
    for (const percent of [0, 0.5, 1001]) {
      expect(sharpOpSchema.safeParse({ op: 'scale', percent }).success).toBe(
        false,
      )
    }
    expect(sharpOpSchema.safeParse({ op: 'scale' }).success).toBe(false)
  })
})

describe('opacity', () => {
  it('multiplies the alpha of every pixel and leaves the colours', async () => {
    const half = await render(solid(4, 4), [opacity(50)])
    const faint = await render(solid(4, 4, 0.5), [opacity(50)])

    expect(half.pixel).toEqual([200, 100, 50, 128])
    expect(faint.pixel[3]).toBe(64)
    expect(faint.pixel.slice(0, 3)).toEqual([200, 100, 50])
  })

  it('leaves the picture alone at 100 and clears it at 0', async () => {
    expect((await render(solid(4, 4), [opacity(100)])).pixel).toEqual([
      200, 100, 50, 255,
    ])
    expect((await render(solid(4, 4), [opacity(0)])).pixel[3]).toBe(0)
  })

  it('keeps the size, and works after a scale', async () => {
    const result = await render(solid(8, 4), [scale(50), opacity(50)])

    expect(result).toMatchObject({ width: 4, height: 2 })
    expect(result.pixel[3]).toBe(128)
  })

  it('accepts only 0 to 100 percent', () => {
    for (const percent of [-1, 101]) {
      expect(sharpOpSchema.safeParse({ op: 'opacity', percent }).success).toBe(
        false,
      )
    }
  })
})

describe('applying them one at a time', () => {
  it('is refused, since they need the picture’s pixels', () => {
    expect(() => applySharpOp(solid(4, 4), scale(50))).toThrow(
      SharpOperationError,
    )
    expect(() => applySharpOp(solid(4, 4), opacity(50))).toThrow(
      SharpOperationError,
    )
  })
})
