// @vitest-environment node
import sharp from 'sharp'
import type { Sharp } from 'sharp'
import { describe, expect, it } from 'vitest'

import { SharpOperationError } from './errors.ts'
import { applySharpOpsBlended, mixTint } from './blend-tint.ts'
import { applySharpOps } from './ops.ts'
import type { SharpOp } from './ops.ts'

const BLUE = { r: 51, g: 136, b: 255 }

function blueImage(channels: 3 | 4 = 3): Sharp {
  return sharp({
    create: {
      width: 4,
      height: 2,
      channels,
      background: channels === 4 ? { ...BLUE, alpha: 0.5 } : BLUE,
    },
  })
}

async function pixels(image: Sharp): Promise<{
  data: number[]
  channels: number
  width: number
  height: number
}> {
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })
  return {
    data: [...data],
    channels: info.channels,
    width: info.width,
    height: info.height,
  }
}

const tint = (colour: unknown): SharpOp => ({ op: 'tint', colour }) as SharpOp

describe('mixTint', () => {
  it('mixes the colour channels by the strength and leaves alpha alone', () => {
    const base = Buffer.from([100, 200, 0, 255, 0, 0, 0, 128])
    const tinted = Buffer.from([200, 100, 50, 255, 100, 100, 100, 255])

    expect([...mixTint(base, tinted, 0.5, 4)]).toEqual([
      150, 150, 25, 255, 50, 50, 50, 128,
    ])
  })

  it('is the base at 0 and the tinted image at 1', () => {
    const base = Buffer.from([10, 20, 30])
    const tinted = Buffer.from([200, 210, 220])

    expect([...mixTint(base, tinted, 0, 3)]).toEqual([10, 20, 30])
    expect([...mixTint(base, tinted, 1, 3)]).toEqual([200, 210, 220])
  })
})

describe('applySharpOpsBlended', () => {
  it('behaves exactly like the plain pipeline for an opaque tint', async () => {
    const ops = [tint({ r: 255, g: 0, b: 0 })]

    const blended = await pixels(await applySharpOpsBlended(blueImage(), ops))
    const plain = await pixels(applySharpOps(blueImage(), ops))

    expect(blended).toEqual(plain)
  })

  it('is the original image when the tint is fully transparent', async () => {
    const ops = [tint({ r: 255, g: 0, b: 0, alpha: 0 })]

    const result = await pixels(await applySharpOpsBlended(blueImage(), ops))

    expect(result.data.slice(0, 3)).toEqual([51, 136, 255])
  })

  it('mixes the original and the full tint by the alpha', async () => {
    const full = await pixels(
      applySharpOps(blueImage(), [tint({ r: 255, g: 0, b: 0 })]),
    )
    const half = await pixels(
      await applySharpOpsBlended(blueImage(), [
        tint({ r: 255, g: 0, b: 0, alpha: 0.5 }),
      ]),
    )

    for (const [index, value] of half.data.slice(0, 3).entries()) {
      const expected = Math.round(
        (([51, 136, 255][index] ?? 0) + (full.data[index] ?? 0)) / 2,
      )
      expect(Math.abs(value - expected)).toBeLessThanOrEqual(1)
    }
  })

  it('reads the alpha of a CSS colour string', async () => {
    const fromObject = await pixels(
      await applySharpOpsBlended(blueImage(), [
        tint({ r: 255, g: 0, b: 0, alpha: 0.2 }),
      ]),
    )
    const fromString = await pixels(
      await applySharpOpsBlended(blueImage(), [tint('rgba(255, 0, 0, 0.2)')]),
    )

    expect(fromString.data).toEqual(fromObject.data)
  })

  it('keeps an image’s own transparency', async () => {
    const result = await pixels(
      await applySharpOpsBlended(blueImage(4), [
        tint({ r: 255, g: 0, b: 0, alpha: 0.5 }),
      ]),
    )

    expect(result.channels).toBe(4)
    expect(result.data[3]).toBe(128)
  })

  it('does not add an alpha channel to an image without one', async () => {
    const result = await pixels(
      await applySharpOpsBlended(blueImage(3), [
        tint({ r: 255, g: 0, b: 0, alpha: 0.5 }),
      ]),
    )

    expect(result.channels).toBe(3)
  })

  it('applies the steps after the blend to the blended image', async () => {
    const result = await pixels(
      await applySharpOpsBlended(blueImage(), [
        tint({ r: 255, g: 0, b: 0, alpha: 0.5 }),
        { op: 'resize', width: 2 },
      ]),
    )

    expect(result.width).toBe(2)
  })

  it('applies the steps before the blend first', async () => {
    const result = await pixels(
      await applySharpOpsBlended(blueImage(), [
        { op: 'resize', width: 2 },
        tint({ r: 255, g: 0, b: 0, alpha: 0.5 }),
      ]),
    )

    expect(result.width).toBe(2)
  })

  it('applies the output steps, wherever they are listed', async () => {
    const image = await applySharpOpsBlended(blueImage(), [
      { op: 'png' },
      tint({ r: 255, g: 0, b: 0, alpha: 0.5 }),
    ])
    const { format } = await sharp(await image.toBuffer()).metadata()

    expect(format).toBe('png')
  })

  it('handles more than one blended tint in a row', async () => {
    const result = await pixels(
      await applySharpOpsBlended(blueImage(), [
        tint({ r: 255, g: 0, b: 0, alpha: 0.5 }),
        tint({ r: 0, g: 255, b: 0, alpha: 0.5 }),
      ]),
    )

    expect(result.data.slice(0, 3)).not.toEqual([51, 136, 255])
  })

  it('names the step that fails, by its place in the whole list', async () => {
    const run = applySharpOpsBlended(blueImage(), [
      tint({ r: 255, g: 0, b: 0, alpha: 0.5 }),
      { op: 'extract', left: 0, top: 0, width: -1, height: 1 },
    ])

    await expect(run).rejects.toThrow(SharpOperationError)
    await expect(run).rejects.toThrow(/ops\[1\] \(extract\)/)
  })
})
