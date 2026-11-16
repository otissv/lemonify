import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ExportFormat } from '@/features/export/export-settings'
import { DEFAULT_LAYER_SETTINGS } from '@/features/pipeline/layer'
import { createSharpStep } from '@/features/pipeline/pipeline'
import type { StepBlend } from '@/features/pipeline/step-blend'

import {
  EngineTargetKind,
  PREVIEW_MAX_SIZE,
  SharpImageEngine,
  THUMBNAIL_MAX_SIZE,
} from './image-engine.ts'
import { RenderError } from './render-error.ts'

const engine = new SharpImageEngine()
let directory: string
let input: string

async function makeImage(
  width: number,
  height: number,
  name = 'input.png',
): Promise<string> {
  const file = path.join(directory, name)
  await sharp({
    create: { width, height, channels: 3, background: '#ff0000' },
  })
    .png()
    .toFile(file)
  return file
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'lemonify-engine-'))
  input = await makeImage(3000, 2000)
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('SharpImageEngine', () => {
  it('writes a preview no larger than the preview size', async () => {
    const output = path.join(directory, 'preview.webp')
    const info = await engine.render({
      input,
      steps: [],
      target: { kind: EngineTargetKind.Preview },
      output,
    })
    expect(info.format).toBe('webp')
    expect(Math.max(info.width, info.height)).toBe(PREVIEW_MAX_SIZE)
    expect((await sharp(output).metadata()).width).toBe(info.width)
  })

  it('writes a thumbnail and never enlarges a small image', async () => {
    const small = await makeImage(40, 30, 'small.png')
    const info = await engine.render({
      input: small,
      steps: [],
      target: { kind: EngineTargetKind.Thumbnail },
      output: path.join(directory, 'thumb.webp'),
    })
    expect(info).toMatchObject({ width: 40, height: 30 })
    const big = await engine.render({
      input,
      steps: [],
      target: { kind: EngineTargetKind.Thumbnail },
      output: path.join(directory, 'thumb-big.webp'),
    })
    expect(Math.max(big.width, big.height)).toBe(THUMBNAIL_MAX_SIZE)
  })

  it('applies the steps before sizing', async () => {
    const info = await engine.render({
      input,
      steps: [createSharpStep('rotate', { angle: 90 })],
      target: { kind: EngineTargetKind.Intermediate },
      output: path.join(directory, 'rotated.png'),
    })
    expect(info).toMatchObject({ format: 'png', width: 2000, height: 3000 })
  })

  it('blends a tint with an alpha into the image by that alpha', async () => {
    const solid = await makeImage(4, 4, 'blue.png')
    await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#3388ff' },
    })
      .png()
      .toFile(solid)
    const output = path.join(directory, 'tinted.png')

    await engine.render({
      input: solid,
      steps: [
        createSharpStep('tint', { colour: { r: 255, g: 0, b: 0, alpha: 0 } }),
      ],
      target: { kind: EngineTargetKind.Intermediate },
      output,
    })

    const { data } = await sharp(output)
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect([...data.subarray(0, 3)]).toEqual([0x33, 0x88, 0xff])
  })

  it('exports in the chosen format at the chosen width', async () => {
    const output = path.join(directory, 'out.jpg')
    const info = await engine.render({
      input,
      steps: [],
      target: {
        kind: EngineTargetKind.Export,
        settings: {
          format: ExportFormat.Jpeg,
          options: { quality: 70 },
          keepMetadata: false,
        },
        width: 600,
      },
      output,
    })
    expect(info).toMatchObject({ format: 'jpeg', width: 600, height: 400 })
  })

  it('keeps the format of the image for Original', async () => {
    const info = await engine.render({
      input,
      steps: [],
      target: {
        kind: EngineTargetKind.Export,
        settings: {
          format: ExportFormat.Original,
          options: {},
          keepMetadata: false,
        },
      },
      output: path.join(directory, 'same.png'),
    })
    expect(info.format).toBe('png')
  })

  it('refuses export options the format does not accept', async () => {
    await expect(
      engine.render({
        input,
        steps: [],
        target: {
          kind: EngineTargetKind.Export,
          settings: {
            format: ExportFormat.Jpeg,
            options: { quality: 500 },
            keepMetadata: false,
          },
        },
        output: path.join(directory, 'bad.jpg'),
      }),
    ).rejects.toThrow(/export options are not valid/)
  })

  it('leaves nothing behind and hides paths when the image cannot be read', async () => {
    const output = path.join(directory, 'never.webp')
    const failure = engine.render({
      input: path.join(directory, 'missing.png'),
      steps: [],
      target: { kind: EngineTargetKind.Preview },
      output,
    })
    await expect(failure).rejects.toBeInstanceOf(RenderError)
    await expect(failure).rejects.not.toThrow(directory)
    expect(await readdir(directory)).toEqual(['input.png'])
  })

  it('can write over the image it read', async () => {
    await engine.render({
      input,
      steps: [createSharpStep('flip')],
      target: { kind: EngineTargetKind.Intermediate },
      output: input,
    })
    expect((await sharp(input).metadata()).format).toBe('png')
  })

  describe('blend on a step', () => {
    async function colourFile(
      name: string,
      colour: string,
      size: number,
    ): Promise<string> {
      const file = path.join(directory, name)
      await sharp({
        create: { width: size, height: size, channels: 3, background: colour },
      })
        .png()
        .toFile(file)
      return file
    }

    async function render(
      steps: Parameters<typeof engine.render>[0]['steps'],
      base: string,
    ): Promise<{ raw: Buffer; width: number }> {
      const output = path.join(directory, 'out.png')
      const info = await engine.render({
        input: base,
        steps,
        target: { kind: EngineTargetKind.Intermediate },
        output,
      })
      return {
        raw: await sharp(output).raw().ensureAlpha().toBuffer(),
        width: info.width,
      }
    }

    const pixel = ({ raw }: { raw: Buffer }, x = 0, y = 0, size = 8) => [
      ...raw.subarray((y * size + x) * 4, (y * size + x) * 4 + 4),
    ]
    const negate = (blend?: StepBlend) => ({
      ...createSharpStep('negate', { alpha: false }),
      ...(blend ? { blend } : {}),
    })

    it('puts the result over the picture before the step, at the blend’s opacity', async () => {
      const base = await colourFile('base.png', '#ff0000', 8)

      const half = await render([negate({ mode: 'normal', opacity: 50 })], base)
      const none = await render([negate({ mode: 'normal', opacity: 0 })], base)
      const full = await render(
        [negate({ mode: 'normal', opacity: 100 })],
        base,
      )

      const [r, g, b, a] = pixel(half)
      expect(Math.abs((r ?? 0) - 128)).toBeLessThanOrEqual(2)
      expect(Math.abs((g ?? 0) - 128)).toBeLessThanOrEqual(2)
      expect(Math.abs((b ?? 0) - 128)).toBeLessThanOrEqual(2)
      expect(a).toBe(255)
      expect(pixel(none)).toEqual([255, 0, 0, 255])
      expect(pixel(full)).toEqual([0, 255, 255, 255])
    })

    it('blends with the mode it is given', async () => {
      const base = await colourFile('base.png', '#ff0000', 8)

      const multiplied = await render(
        [negate({ mode: 'multiply', opacity: 100 })],
        base,
      )
      const screened = await render(
        [negate({ mode: 'screen', opacity: 100 })],
        base,
      )

      expect(pixel(multiplied)).toEqual([0, 0, 0, 255])
      expect(pixel(screened)).toEqual([255, 255, 255, 255])
    })

    it('does the same as no blend when there is none, or it is the default', async () => {
      const base = await colourFile('base.png', '#ff0000', 8)

      const plain = await render([negate()], base)
      const normal = await render(
        [negate({ mode: 'normal', opacity: 100 })],
        base,
      )

      expect(pixel(plain)).toEqual([0, 255, 255, 255])
      expect(pixel(normal)).toEqual(pixel(plain))
    })

    it('blends against the picture as the layers before it left it, and the steps after it go on from the blend', async () => {
      const base = await colourFile('base.png', '#ff0000', 8)
      const layer = await colourFile('layer.png', '#0000ff', 2)

      const result = await render(
        [
          {
            kind: 'layer' as const,
            path: layer,
            ...DEFAULT_LAYER_SETTINGS,
          },
          negate({ mode: 'multiply', opacity: 100 }),
          createSharpStep('negate', { alpha: false }),
        ],
        base,
      )

      expect(pixel(result, 4, 4)).toEqual([255, 255, 255, 255])
      expect(pixel(result, 0, 0)).toEqual([255, 255, 255, 255])
    })
  })

  describe('the scale and opacity tools', () => {
    it('scale changes the size of the picture, and opacity makes it see-through', async () => {
      const output = path.join(directory, 'scaled.png')
      const info = await engine.render({
        input,
        steps: [
          createSharpStep('scale', { percent: 10 }),
          createSharpStep('opacity', { percent: 50 }),
        ],
        target: { kind: EngineTargetKind.Intermediate },
        output,
      })

      expect([info.width, info.height]).toEqual([300, 200])
      const raw = await sharp(output).raw().ensureAlpha().toBuffer()
      expect([...raw.subarray(0, 4)]).toEqual([255, 0, 0, 128])
    })
  })

  describe('layers', () => {
    async function colourFile(
      name: string,
      colour: string,
      size = 4,
      channels: 3 | 4 = 3,
    ): Promise<string> {
      const file = path.join(directory, name)
      await sharp({
        create: { width: size, height: size, channels, background: colour },
      })
        .png()
        .toFile(file)
      return file
    }

    async function render(
      steps: Parameters<typeof engine.render>[0]['steps'],
      base: string,
    ): Promise<Buffer> {
      const output = path.join(directory, 'out.png')
      await engine.render({
        input: base,
        steps,
        target: { kind: EngineTargetKind.Intermediate },
        output,
      })
      return sharp(output).raw().ensureAlpha().toBuffer()
    }

    function layerOf(file: string, settings = {}) {
      return {
        kind: 'layer' as const,
        path: file,
        ...DEFAULT_LAYER_SETTINGS,
        ...settings,
      }
    }

    const at = (raw: Buffer, x: number, y: number, size = 8) => [
      ...raw.subarray((y * size + x) * 4, (y * size + x) * 4 + 4),
    ]

    it('draws a layer over the picture', async () => {
      const base = await colourFile('base.png', '#ff0000', 8)
      const layer = await colourFile('layer.png', '#0000ff', 2)

      const raw = await render([layerOf(layer)], base)

      expect(at(raw, 4, 4)).toEqual([0, 0, 255, 255])
      expect(at(raw, 0, 0)).toEqual([255, 0, 0, 255])
    })

    it('applies a step placed before a layer to the picture only', async () => {
      const base = await colourFile('base.png', '#ff0000', 8)
      const layer = await colourFile('layer.png', '#0000ff', 2)

      const raw = await render(
        [createSharpStep('negate', { alpha: false }), layerOf(layer)],
        base,
      )

      expect(at(raw, 0, 0)).toEqual([0, 255, 255, 255])
      expect(at(raw, 4, 4)).toEqual([0, 0, 255, 255])
    })

    it('applies a step placed after a layer to the layer as well', async () => {
      const base = await colourFile('base.png', '#ff0000', 8)
      const layer = await colourFile('layer.png', '#0000ff', 2)

      const raw = await render(
        [layerOf(layer), createSharpStep('negate', { alpha: false })],
        base,
      )

      expect(at(raw, 0, 0)).toEqual([0, 255, 255, 255])
      expect(at(raw, 4, 4)).toEqual([255, 255, 0, 255])
    })

    it('stacks layers in order, the later one on top', async () => {
      const base = await colourFile('base.png', '#ff0000', 8)
      const blue = await colourFile('blue.png', '#0000ff', 4)
      const green = await colourFile('green.png', '#00ff00', 2)

      const raw = await render([layerOf(blue), layerOf(green)], base)

      expect(at(raw, 4, 4)).toEqual([0, 255, 0, 255])
      expect(at(raw, 2, 2)).toEqual([0, 0, 255, 255])
    })

    it('measures a layer against the picture as the steps before it left it', async () => {
      const base = await colourFile('base.png', '#ff0000', 8)
      const layer = await colourFile('layer.png', '#0000ff', 8)
      const output = path.join(directory, 'out.png')

      await engine.render({
        input: base,
        steps: [
          createSharpStep('resize', { width: 4, height: 4 }),
          layerOf(layer),
        ],
        target: { kind: EngineTargetKind.Intermediate },
        output,
      })

      const meta = await sharp(output).metadata()
      expect([meta.width, meta.height]).toEqual([4, 4])
      const raw = await sharp(output).raw().ensureAlpha().toBuffer()
      expect(at(raw, 0, 0, 4)).toEqual([0, 0, 255, 255])
    })

    it('flattens transparency onto white when the picture is saved as a JPEG', async () => {
      const base = await colourFile(
        'clear.png',
        { r: 0, g: 0, b: 0, alpha: 0 } as never,
        4,
        4,
      )
      const layer = await colourFile('layer.png', '#0000ff', 2)
      const output = path.join(directory, 'out.jpg')

      await engine.render({
        input: base,
        steps: [layerOf(layer)],
        target: {
          kind: EngineTargetKind.Export,
          settings: {
            format: ExportFormat.Jpeg,
            options: {},
            keepMetadata: false,
          },
        },
        output,
      })

      const raw = await sharp(output).raw().toBuffer()
      expect(raw[0]).toBeGreaterThan(245)
      expect(raw[1]).toBeGreaterThan(245)
      expect(raw[2]).toBeGreaterThan(245)
    })

    it('keeps transparency in a PNG export', async () => {
      const base = await colourFile(
        'clear.png',
        { r: 0, g: 0, b: 0, alpha: 0 } as never,
        4,
        4,
      )
      const layer = await colourFile('layer.png', '#0000ff', 2)
      const output = path.join(directory, 'out.png')

      await engine.render({
        input: base,
        steps: [layerOf(layer)],
        target: {
          kind: EngineTargetKind.Export,
          settings: {
            format: ExportFormat.Png,
            options: {},
            keepMetadata: false,
          },
        },
        output,
      })

      const raw = await sharp(output).raw().ensureAlpha().toBuffer()
      expect(raw[3]).toBe(0)
    })

    it('says plainly when a layer’s image cannot be read', async () => {
      const base = await colourFile('base.png', '#ff0000', 4)

      await expect(
        render([layerOf(path.join(directory, 'gone.png'))], base),
      ).rejects.toBeInstanceOf(RenderError)
    })
  })
})
