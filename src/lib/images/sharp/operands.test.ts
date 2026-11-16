// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import type { Sharp } from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applySharpOpsBlended } from './blend-tint.ts'
import { sharpOpSchema } from './ops.ts'
import { toRgba } from './pixel-ops.ts'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'lemonify-operands-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function operandFile(background: string): Promise<string> {
  const file = path.join(directory, `operand-${background.slice(1)}.png`)
  await sharp({ create: { width: 4, height: 4, channels: 3, background } })
    .png()
    .toFile(file)
  return file
}

function picture(channels: 3 | 4): Sharp {
  return sharp({
    create: {
      width: 4,
      height: 4,
      channels,
      background:
        channels === 4
          ? { r: 255, g: 128, b: 0, alpha: 1 }
          : { r: 255, g: 128, b: 0 },
    },
  })
}

describe('boolean with an image from a file', () => {
  it.each([3, 4] as const)(
    'combines a picture of %i bands with an operand of three',
    async (channels) => {
      const operand = await operandFile('#0f0f0f')
      const op = sharpOpSchema.parse({
        op: 'boolean',
        operand,
        operator: 'and',
      })
      const done = await applySharpOpsBlended(picture(channels), [op], 'pixels')
      const { data, info } = await done
        .raw()
        .toBuffer({ resolveWithObject: true })
      expect(info.channels).toBe(channels)
      expect([...data.subarray(0, 3)]).toEqual([15, 0, 0])
    },
  )

  it('works on a picture that was rendered to pixels first', async () => {
    const operand = await operandFile('#f0f0f0')
    const ops = [
      sharpOpSchema.parse({ op: 'scale', percent: 100 }),
      sharpOpSchema.parse({ op: 'boolean', operand, operator: 'or' }),
    ]
    const done = await applySharpOpsBlended(picture(3), ops, 'pixels')
    const { data } = await done.raw().toBuffer({ resolveWithObject: true })
    expect([...data.subarray(0, 3)]).toEqual([255, 240, 240])
  })
})

describe('boolean and the alpha channel', () => {
  it('leaves the transparency of the picture as it is', async () => {
    const operand = await operandFile('#ffffff')
    const op = sharpOpSchema.parse({ op: 'boolean', operand, operator: 'eor' })
    const half = sharp({
      create: {
        width: 4,
        height: 4,
        channels: 4,
        background: { r: 255, g: 128, b: 0, alpha: 0.5 },
      },
    })
    const done = await applySharpOpsBlended(half, [op], 'pixels')
    const { data } = await done.raw().toBuffer({ resolveWithObject: true })
    expect([...data.subarray(0, 4)]).toEqual([0, 127, 255, 128])
  })
})

describe('toRgba', () => {
  it('keeps the transparency of a picture that is turned grey', async () => {
    const transparent = sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 200, g: 50, b: 50, alpha: 0 },
      },
    }).greyscale()
    const rgba = await toRgba(transparent)
    expect(rgba.data[3]).toBe(0)
  })

  it.each([
    [
      'one band',
      sharp({
        create: { width: 2, height: 2, channels: 3, background: '#808080' },
      }).greyscale(),
    ],
    ['three bands', picture(3)],
    ['four bands', picture(4)],
  ])('gives four bands for a picture of %s', async (_, image) => {
    const rgba = await toRgba(image)
    expect(rgba.channels).toBe(4)
    expect(rgba.data.length).toBe(rgba.width * rgba.height * 4)
  })

  it('keeps the first four bands of a picture that has more, as the colour and the alpha', async () => {
    const mask = await operandFile('#404040')
    const joined = picture(3).joinChannel(mask)
    const rgba = await toRgba(joined)
    expect([...rgba.data.subarray(0, 4)]).toEqual([255, 128, 0, 64])
  })
})
