import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ExportFormat } from '@/features/export/export-settings'
import { createSharpStep } from '@/features/pipeline/pipeline'

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
})
