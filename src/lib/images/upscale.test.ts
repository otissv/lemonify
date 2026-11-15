// @vitest-environment node
import { access } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createImage,
  createTempDir,
  listFiles,
  removeDir,
} from '@/test/image-fixtures.ts'

import { UpscaleTargetError } from './errors.ts'
import { upscaleImages } from './upscale.ts'
import type { AiPass, UpscaleEngine } from './upscale.ts'

const HALF = 0.5

function resizingEngine(passes: AiPass[]): UpscaleEngine {
  return async (pass) => {
    passes.push(pass)
    const { width } = await sharp(pass.input).metadata()
    await sharp(pass.input)
      .resize({ width: width * pass.scale })
      .png()
      .toFile(pass.output)
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

describe('upscaleImages', () => {
  let root = ''
  let source = ''
  let destination = ''

  beforeEach(async () => {
    root = await createTempDir('upscale')
    source = path.join(root, 'photos')
    destination = path.join(root, 'out')
  })

  afterEach(async () => {
    await removeDir(root)
  })

  it('runs the default model at its largest scale and keeps the file name', async () => {
    const file = await createImage(path.join(source, 'photo.jpg'), {
      width: 40,
      height: 20,
    })
    const passes: AiPass[] = []

    const results = await upscaleImages(
      { source, destination },
      resizingEngine(passes),
    )

    const output = path.join(destination, 'photo.jpg')
    expect(passes).toHaveLength(1)
    expect(passes[0]).toMatchObject({
      input: file,
      scale: 4,
      model: { kind: 'pinned', model: { name: '4x_NMKD-Siax_200k' } },
    })
    expect(passes[0]?.output).toMatch(/\.png$/)
    expect(results).toEqual([{ source: file, output, width: 160, height: 80 }])
    expect(await exists(passes[0]?.output ?? '')).toBe(false)
  })

  it('chains passes for iterations', async () => {
    await createImage(path.join(source, 'a.png'), {
      width: 10,
      height: 10,
      format: 'png',
    })
    const passes: AiPass[] = []

    const [result] = await upscaleImages(
      { source, destination, scale: 2, iterations: 2 },
      resizingEngine(passes),
    )

    expect(passes).toHaveLength(2)
    expect(passes[1]?.input).toBe(passes[0]?.output)
    expect(result).toMatchObject({ width: 40, height: 40 })
  })

  it('applies the Sharp post-pipeline and names the output after its format', async () => {
    await createImage(path.join(source, 'photo.jpg'), { width: 20, height: 10 })

    const [result] = await upscaleImages(
      {
        source,
        destination,
        ops: [
          { op: 'resize', width: 50 },
          { op: 'webp', quality: 70 },
        ],
      },
      resizingEngine([]),
    )

    expect(result.output).toBe(path.join(destination, 'photo.webp'))
    expect(await sharp(result.output).metadata()).toMatchObject({
      format: 'webp',
      width: 50,
    })
  })

  it('converts formats upscayl-bin cannot read and keeps the source format', async () => {
    await createImage(path.join(source, 'a.avif'), {
      width: 8,
      height: 8,
      format: 'avif',
    })
    const passes: AiPass[] = []

    const [result] = await upscaleImages(
      { source, destination, scale: 2 },
      resizingEngine(passes),
    )

    expect(passes[0]?.input).toMatch(/\.png$/)
    expect(result.output).toBe(path.join(destination, 'a.avif'))
    expect((await sharp(result.output).metadata()).format).toBe('heif')
  })

  it('applies EXIF orientation before upscaling', async () => {
    await createImage(path.join(source, 'portrait.jpg'), {
      width: 20,
      height: 10,
      orientation: 6,
    })

    const [result] = await upscaleImages(
      { source, destination, scale: 2 },
      resizingEngine([]),
    )

    expect(result).toMatchObject({ width: 20, height: 40 })
  })

  it('passes a custom model through to the engine', async () => {
    await createImage(path.join(source, 'a.png'), {
      width: 8,
      height: 8,
      format: 'png',
    })
    const passes: AiPass[] = []

    await upscaleImages(
      {
        source,
        destination,
        customModel: { directory: '/models', name: 'mine-2x', scale: 2 },
      },
      resizingEngine(passes),
    )

    expect(passes[0]).toMatchObject({
      scale: 2,
      model: { kind: 'custom', name: 'mine-2x', directory: '/models' },
    })
  })

  it('mirrors subfolders when recursive', async () => {
    await createImage(path.join(source, 'a.jpg'), { width: 8, height: 8 })
    await createImage(path.join(source, 'nested', 'b.webp'), {
      width: 8,
      height: 8,
      format: 'webp',
    })

    await upscaleImages(
      { source, destination, recursive: true, scale: 2 },
      resizingEngine([]),
    )

    expect(await listFiles(destination)).toEqual(['a.jpg', 'nested/b.webp'])
  })

  it('refuses to overwrite a source file', async () => {
    await createImage(path.join(source, 'a.jpg'), { width: 8, height: 8 })

    await expect(
      upscaleImages({ source, destination: source }, resizingEngine([])),
    ).rejects.toThrow(UpscaleTargetError)
  })

  it('reports overall progress across images and passes, ending at 1', async () => {
    await createImage(path.join(source, 'a.png'), {
      width: 8,
      height: 8,
      format: 'png',
    })
    await createImage(path.join(source, 'b.png'), {
      width: 8,
      height: 8,
      format: 'png',
    })
    const resize = resizingEngine([])
    const halfwayEngine: UpscaleEngine = async (pass, onProgress) => {
      onProgress?.(HALF)
      await resize(pass)
      onProgress?.(1)
    }
    const reported: Array<number> = []

    await upscaleImages(
      { source, destination, scale: 2, iterations: 2 },
      halfwayEngine,
      (fraction) => reported.push(fraction),
    )

    expect(reported).toEqual([0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1])
  })
})
