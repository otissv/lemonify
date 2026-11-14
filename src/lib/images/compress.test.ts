// @vitest-environment node
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createImage,
  createTempDir,
  listFiles,
  removeDir,
} from '@/test/image-fixtures.ts'

import { compressImages } from './compress.ts'
import { CompressTargetError, ImageSourceError } from './errors.ts'
import { DEFAULT_MAX_WIDTH } from './options.ts'

async function sizeOf(file: string): Promise<number> {
  return (await stat(file)).size
}

describe('compressImages', () => {
  let root = ''
  let source = ''

  beforeEach(async () => {
    root = await createTempDir('compress')
    source = path.join(root, 'photos')
  })

  afterEach(async () => {
    await removeDir(root)
  })

  it('shrinks oversized images in place and keeps their format', async () => {
    const file = await createImage(path.join(source, 'photo.jpg'), {
      width: DEFAULT_MAX_WIDTH * 2,
      height: 400,
      noise: true,
      quality: 100,
    })
    const before = await sizeOf(file)

    const results = await compressImages({ source })

    const metadata = await sharp(file).metadata()
    expect(metadata.format).toBe('jpeg')
    expect(metadata.width).toBe(DEFAULT_MAX_WIDTH)
    expect(await sizeOf(file)).toBeLessThan(before)
    expect(results).toEqual([
      expect.objectContaining({
        source: file,
        output: file,
        before,
        written: true,
      }),
    ])
  })

  it('honours --max-width', async () => {
    const file = await createImage(path.join(source, 'photo.webp'), {
      width: 1200,
      height: 600,
      noise: true,
      format: 'webp',
      quality: 100,
    })

    await compressImages({ source: file, maxWidth: 600 })

    expect((await sharp(file).metadata()).width).toBe(600)
  })

  it('leaves a file alone in place when recompressing would not shrink it', async () => {
    const file = await createImage(path.join(source, 'small.jpg'), {
      width: 64,
      height: 64,
      quality: 20,
    })
    const original = await readFile(file)

    const [result] = await compressImages({ source: file, quality: 100 })

    expect(result).toEqual(
      expect.objectContaining({ written: false, after: original.byteLength }),
    )
    expect(await readFile(file)).toEqual(original)
  })

  it('writes to a destination and leaves the originals untouched', async () => {
    const large = await createImage(path.join(source, 'large.jpg'), {
      width: 2400,
      height: 400,
      noise: true,
      quality: 100,
    })
    const small = await createImage(path.join(source, 'small.jpg'), {
      width: 64,
      height: 64,
      quality: 20,
    })
    const originals = [await readFile(large), await readFile(small)]
    const destination = path.join(root, 'compressed')

    const results = await compressImages({ source, destination, quality: 100 })

    expect([await readFile(large), await readFile(small)]).toEqual(originals)
    expect(await listFiles(destination)).toEqual(['large.jpg', 'small.jpg'])
    expect(results.map((result) => result.written)).toEqual([true, true])
    expect(
      (await sharp(path.join(destination, 'large.jpg')).metadata()).width,
    ).toBe(DEFAULT_MAX_WIDTH)
  })

  it('mirrors subfolders into the destination with --recursive', async () => {
    await createImage(path.join(source, 'a', 'b.png'), {
      width: 100,
      height: 100,
      format: 'png',
    })
    const destination = path.join(root, 'compressed')

    await compressImages({ source, destination, recursive: true })

    expect(await listFiles(destination)).toEqual(['a/b.png'])
  })

  it('never deletes existing files in the destination', async () => {
    const file = await createImage(path.join(source, 'a.jpg'), {
      width: 100,
      height: 100,
    })
    const destination = path.join(root, 'compressed')
    await createImage(path.join(destination, 'keep.jpg'), {
      width: 10,
      height: 10,
    })

    await compressImages({ source: file, destination })

    expect(await listFiles(destination)).toEqual(['a.jpg', 'keep.jpg'])
  })

  it('refuses a destination that resolves to the source files', async () => {
    const file = await createImage(path.join(source, 'a.jpg'), {
      width: 100,
      height: 100,
    })
    const original = await readFile(file)

    await expect(
      compressImages({ source: file, destination: source }),
    ).rejects.toThrow(CompressTargetError)
    expect(await readFile(file)).toEqual(original)
  })

  it('fails clearly when the source does not exist', async () => {
    await expect(
      compressImages({ source: path.join(root, 'missing') }),
    ).rejects.toThrow(ImageSourceError)
  })
})
