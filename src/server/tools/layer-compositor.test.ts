// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_LAYER_SETTINGS } from '@/features/pipeline/layer'

import { compositeLayer } from './layer-compositor.ts'
import type { EngineLayer, RawImage } from './layer-compositor.ts'

type Colour = readonly [number, number, number, number]

let directory = ''

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'lemonify-layer-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function solid(width: number, height: number, [r, g, b, a]: Colour): RawImage {
  const data = Buffer.alloc(width * height * 4)
  for (let at = 0; at < data.length; at += 4) {
    data[at] = r
    data[at + 1] = g
    data[at + 2] = b
    data[at + 3] = a
  }
  return { data, width, height }
}

async function layerFile(
  name: string,
  image: RawImage,
  orientation?: number,
): Promise<string> {
  const file = path.join(directory, name)
  const encoded = sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
  if (orientation === undefined) await encoded.png().toFile(file)
  else await encoded.flatten().jpeg().withMetadata({ orientation }).toFile(file)
  return file
}

function layer(file: string, settings: Partial<EngineLayer> = {}): EngineLayer {
  return { kind: 'layer', path: file, ...DEFAULT_LAYER_SETTINGS, ...settings }
}

function pixel(image: RawImage, x: number, y: number): Colour {
  const at = (y * image.width + x) * 4
  return [
    image.data[at] ?? -1,
    image.data[at + 1] ?? -1,
    image.data[at + 2] ?? -1,
    image.data[at + 3] ?? -1,
  ]
}

const RED: Colour = [255, 0, 0, 255]
const BLUE: Colour = [0, 0, 255, 255]

describe('compositeLayer', () => {
  it('puts an opaque layer over the middle of the canvas and leaves the rest alone', async () => {
    const file = await layerFile('blue.png', solid(2, 2, BLUE))

    const out = await compositeLayer(solid(6, 6, RED), layer(file))

    expect([out.width, out.height]).toEqual([6, 6])
    expect(pixel(out, 2, 2)).toEqual(BLUE)
    expect(pixel(out, 3, 3)).toEqual(BLUE)
    expect(pixel(out, 1, 1)).toEqual(RED)
    expect(pixel(out, 4, 4)).toEqual(RED)
  })

  it('shows the canvas through the transparent parts of the layer, and blends the half transparent ones', async () => {
    const image = solid(2, 1, [0, 0, 255, 0])
    image.data.set([0, 0, 255, 128], 4)
    const file = await layerFile('cutout.png', image)

    const out = await compositeLayer(
      solid(2, 1, RED),
      layer(file, { anchor: 'northwest' }),
    )

    expect(pixel(out, 0, 0)).toEqual(RED)
    const [r, g, b, a] = pixel(out, 1, 0)
    expect(r).toBeCloseTo(127, -1)
    expect(g).toBe(0)
    expect(b).toBeCloseTo(128, -1)
    expect(a).toBe(255)
  })

  it('keeps the layer’s own transparency where the canvas is transparent too', async () => {
    const file = await layerFile('half.png', solid(1, 1, [0, 0, 255, 128]))

    const out = await compositeLayer(
      solid(1, 1, [0, 0, 0, 0]),
      layer(file, { anchor: 'northwest' }),
    )

    expect(pixel(out, 0, 0)).toEqual([0, 0, 255, 128])
  })

  it('lets only part of the layer show at an opacity below 100', async () => {
    const file = await layerFile('blue.png', solid(1, 1, BLUE))

    const out = await compositeLayer(
      solid(1, 1, RED),
      layer(file, { opacity: 50, anchor: 'northwest' }),
    )

    const [r, , b] = pixel(out, 0, 0)
    expect(r).toBeCloseTo(127, -1)
    expect(b).toBeCloseTo(127, -1)
  })

  it('shows nothing of the layer at opacity 0', async () => {
    const file = await layerFile('blue.png', solid(1, 1, BLUE))

    const out = await compositeLayer(
      solid(1, 1, RED),
      layer(file, { opacity: 0, anchor: 'northwest' }),
    )

    expect(pixel(out, 0, 0)).toEqual(RED)
  })

  it('combines colours by the blend mode', async () => {
    const grey = await layerFile('grey.png', solid(1, 1, [128, 128, 128, 255]))

    const multiplied = await compositeLayer(
      solid(1, 1, [200, 100, 50, 255]),
      layer(grey, { blend: 'multiply', anchor: 'northwest' }),
    )
    const screened = await compositeLayer(
      solid(1, 1, [200, 100, 50, 255]),
      layer(grey, { blend: 'screen', anchor: 'northwest' }),
    )

    expect(pixel(multiplied, 0, 0)[0]).toBeCloseTo(100, -1)
    expect(pixel(screened, 0, 0)[0]).toBeCloseTo(228, -1)
    expect(pixel(multiplied, 0, 0)[0]).toBeLessThan(pixel(screened, 0, 0)[0])
  })

  it('shrinks a layer larger than the canvas to fit inside it', async () => {
    const file = await layerFile('big.png', solid(40, 20, BLUE))

    const out = await compositeLayer(solid(10, 10, RED), layer(file))

    expect(pixel(out, 5, 5)).toEqual(BLUE)
    expect(pixel(out, 0, 1)).toEqual(RED)
    expect(pixel(out, 0, 2)).toEqual(BLUE)
    expect(pixel(out, 9, 6)).toEqual(BLUE)
    expect(pixel(out, 9, 7)).toEqual(RED)
  })

  it('covers the whole canvas with fit cover', async () => {
    const file = await layerFile('small.png', solid(2, 1, BLUE))

    const out = await compositeLayer(
      solid(8, 8, RED),
      layer(file, { fit: 'cover' }),
    )

    for (const [x, y] of [
      [0, 0],
      [7, 0],
      [0, 7],
      [7, 7],
      [4, 4],
    ] as const) {
      expect(pixel(out, x, y)).toEqual(BLUE)
    }
  })

  it('places the layer against an anchor and moves it by x and y', async () => {
    const file = await layerFile('blue.png', solid(2, 2, BLUE))

    const out = await compositeLayer(
      solid(10, 10, RED),
      layer(file, { anchor: 'southeast', x: -1, y: -2 }),
    )

    expect(pixel(out, 7, 6)).toEqual(BLUE)
    expect(pixel(out, 8, 7)).toEqual(BLUE)
    expect(pixel(out, 9, 9)).toEqual(RED)
    expect(pixel(out, 6, 6)).toEqual(RED)
  })

  it('cuts off what is moved past the edge of the canvas, and does not grow it', async () => {
    const file = await layerFile('blue.png', solid(4, 4, BLUE))

    const out = await compositeLayer(
      solid(6, 6, RED),
      layer(file, { anchor: 'northwest', x: -2, y: -2 }),
    )

    expect([out.width, out.height]).toEqual([6, 6])
    expect(pixel(out, 1, 1)).toEqual(BLUE)
    expect(pixel(out, 2, 2)).toEqual(RED)
  })

  it('leaves the canvas as it was when the layer is wholly off it', async () => {
    const file = await layerFile('blue.png', solid(2, 2, BLUE))
    const canvas = solid(4, 4, RED)

    const out = await compositeLayer(
      canvas,
      layer(file, { anchor: 'northwest', x: 100 }),
    )

    expect(out.data.equals(canvas.data)).toBe(true)
  })

  it('applies the scale after the fit', async () => {
    const file = await layerFile('blue.png', solid(2, 2, BLUE))

    const out = await compositeLayer(
      solid(8, 8, RED),
      layer(file, { fit: 'original', scale: 200 }),
    )

    expect(pixel(out, 2, 2)).toEqual(BLUE)
    expect(pixel(out, 5, 5)).toEqual(BLUE)
    expect(pixel(out, 1, 1)).toEqual(RED)
    expect(pixel(out, 6, 6)).toEqual(RED)
  })

  it('turns the layer about its middle, so a wide layer turned a quarter turn is tall', async () => {
    const file = await layerFile('wide.png', solid(6, 2, BLUE))

    const out = await compositeLayer(
      solid(8, 8, RED),
      layer(file, { fit: 'original', rotation: 90 }),
    )

    expect(pixel(out, 4, 1)).toEqual(BLUE)
    expect(pixel(out, 4, 6)).toEqual(BLUE)
    expect(pixel(out, 1, 4)).toEqual(RED)
  })

  it('reads the orientation of a photo before placing it', async () => {
    const file = await layerFile('photo.jpg', solid(8, 4, BLUE), 6)

    const out = await compositeLayer(
      solid(10, 10, RED),
      layer(file, { fit: 'original' }),
    )

    expect(pixel(out, 5, 1)[2]).toBeGreaterThan(240)
    expect(pixel(out, 5, 8)[2]).toBeGreaterThan(240)
    expect(pixel(out, 1, 5)).toEqual(RED)
  })

  it('says plainly when the layer’s image cannot be read', async () => {
    await expect(
      compositeLayer(solid(2, 2, RED), layer(path.join(directory, 'gone.png'))),
    ).rejects.toThrow()
  })
})
