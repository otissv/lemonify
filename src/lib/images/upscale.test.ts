// @vitest-environment node
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createImage,
  createTempDir,
  listFiles,
  removeDir,
} from '@/test/image-fixtures.ts'

import { ImageSourceError, UpscaleTargetError } from './errors.ts'
import { upscaleImages } from './upscale.ts'
import type { UpscaleEngine, UpscaleJob } from './upscale.ts'

function resizingEngine(jobs: UpscaleJob[]): UpscaleEngine {
  return async (job) => {
    jobs.push(job)
    const { width } = await sharp(job.source).metadata()
    await sharp(job.source)
      .resize({ width: width * job.scale })
      .toFile(job.output)
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

  it('upscales with the default model and scale, keeping file names', async () => {
    const file = await createImage(path.join(source, 'photo.jpg'), {
      width: 40,
      height: 20,
    })
    const jobs: UpscaleJob[] = []

    const results = await upscaleImages(
      { source, destination },
      resizingEngine(jobs),
    )

    const output = path.join(destination, 'photo.jpg')
    expect(jobs).toEqual([{ source: file, output, model: 'siax', scale: 4 }])
    expect(results).toEqual([{ source: file, output, width: 160, height: 80 }])
  })

  it('passes the chosen model and scale to the engine', async () => {
    await createImage(path.join(source, 'art.png'), {
      width: 10,
      height: 10,
      format: 'png',
    })
    const jobs: UpscaleJob[] = []

    const results = await upscaleImages(
      { source, destination, model: 'animevideov3', scale: 2 },
      resizingEngine(jobs),
    )

    expect(jobs[0]).toMatchObject({ model: 'animevideov3', scale: 2 })
    expect(results[0]).toMatchObject({ width: 20, height: 20 })
  })

  it('mirrors subfolders when recursive and creates them', async () => {
    await createImage(path.join(source, 'a.jpg'), { width: 8, height: 8 })
    await createImage(path.join(source, 'nested', 'b.webp'), {
      width: 8,
      height: 8,
      format: 'webp',
    })

    await upscaleImages(
      { source, destination, recursive: true },
      resizingEngine([]),
    )

    expect(await listFiles(destination)).toEqual(['a.jpg', 'nested/b.webp'])
  })

  it('rejects AVIF sources before running the engine', async () => {
    await createImage(path.join(source, 'a.avif'), {
      width: 8,
      height: 8,
      format: 'avif',
    })
    const jobs: UpscaleJob[] = []

    await expect(
      upscaleImages({ source, destination }, resizingEngine(jobs)),
    ).rejects.toThrow(ImageSourceError)
    expect(jobs).toEqual([])
  })

  it('refuses to overwrite a source file', async () => {
    await createImage(path.join(source, 'a.jpg'), { width: 8, height: 8 })

    await expect(
      upscaleImages({ source, destination: source }, resizingEngine([])),
    ).rejects.toThrow(UpscaleTargetError)
  })
})
