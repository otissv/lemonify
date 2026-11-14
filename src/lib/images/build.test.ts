// @vitest-environment node
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createImage,
  createTempDir,
  listFiles,
  removeDir,
} from '@/test/image-fixtures.ts'

import { buildImages } from './build.ts'
import { ImageSourceError, OutputCollisionError } from './errors.ts'
import { imageManifestSchema } from './manifest.ts'

describe('buildImages', () => {
  let root = ''
  let source = ''
  let destination = ''

  beforeEach(async () => {
    root = await createTempDir('build')
    source = path.join(root, 'photos')
    destination = path.join(root, 'out')
  })

  afterEach(async () => {
    await removeDir(root)
  })

  it('writes one file per planned width for a file source', async () => {
    const file = await createImage(path.join(source, 'beach.jpg'), {
      width: 1000,
      height: 500,
    })

    const results = await buildImages({
      source: file,
      destination,
      widths: [640, 1280],
      format: 'avif',
    })

    expect(await listFiles(destination)).toEqual([
      'beach-1000.avif',
      'beach-640.avif',
    ])
    const metadata = await sharp(
      path.join(destination, 'beach-640.avif'),
    ).metadata()
    expect(metadata.format).toBe('heif')
    expect(metadata.width).toBe(640)
    expect(results).toEqual([
      expect.objectContaining({ source: file, width: 1000, height: 500 }),
    ])
  })

  it('processes only the top level of a folder without --recursive', async () => {
    await createImage(path.join(source, 'a.jpg'), { width: 600, height: 400 })
    await createImage(path.join(source, 'b.png'), {
      width: 600,
      height: 400,
      format: 'png',
    })
    await createImage(path.join(source, 'nested', 'c.jpg'), {
      width: 600,
      height: 400,
    })
    await writeFile(path.join(source, 'notes.txt'), 'not an image')

    await buildImages({ source, destination, widths: [480, 1280] })

    expect(await listFiles(destination)).toEqual([
      'a-480.webp',
      'a-600.webp',
      'b-480.webp',
      'b-600.webp',
    ])
  })

  it('keeps the subfolder structure with --recursive', async () => {
    await createImage(path.join(source, 'a.jpg'), { width: 500, height: 400 })
    await createImage(path.join(source, '2026', 'summer', 'c.jpg'), {
      width: 500,
      height: 400,
    })

    await buildImages({
      source,
      destination,
      widths: [500],
      format: 'jpeg',
      recursive: true,
    })

    expect(await listFiles(destination)).toEqual([
      '2026/summer/c-500.jpeg',
      'a-500.jpeg',
    ])
  })

  it('skips a destination nested inside the source folder', async () => {
    await createImage(path.join(source, 'a.jpg'), { width: 500, height: 400 })
    const nested = path.join(source, 'out')
    await createImage(path.join(nested, 'old.jpg'), { width: 500, height: 400 })

    await buildImages({
      source,
      destination: nested,
      widths: [500],
      recursive: true,
    })

    expect(await listFiles(nested)).toEqual(['a-500.webp', 'old.jpg'])
  })

  it('applies EXIF orientation before planning and resizing', async () => {
    const file = await createImage(path.join(source, 'portrait.jpg'), {
      width: 200,
      height: 100,
      orientation: 6,
    })

    const [result] = await buildImages({
      source: file,
      destination,
      widths: [50, 1000],
    })

    expect(result).toEqual(expect.objectContaining({ width: 100, height: 200 }))
    expect(await listFiles(destination)).toEqual([
      'portrait-100.webp',
      'portrait-50.webp',
    ])
    const metadata = await sharp(
      path.join(destination, 'portrait-100.webp'),
    ).metadata()
    expect({ width: metadata.width, height: metadata.height }).toEqual({
      width: 100,
      height: 200,
    })
  })

  it('never deletes existing files in the destination', async () => {
    const file = await createImage(path.join(source, 'a.jpg'), {
      width: 500,
      height: 400,
    })
    await writeFile(path.join(destination, '..', 'keep.txt'), 'outside')
    await createImage(path.join(destination, 'existing.jpg'), {
      width: 10,
      height: 10,
    })
    await createImage(path.join(destination, 'sub', 'deep.jpg'), {
      width: 10,
      height: 10,
    })

    await buildImages({ source: file, destination, widths: [500] })

    expect(await listFiles(destination)).toEqual([
      'a-500.webp',
      'existing.jpg',
      'sub/deep.jpg',
    ])
  })

  it('writes a manifest only when asked', async () => {
    await createImage(path.join(source, 'nested', 'a.jpg'), {
      width: 800,
      height: 600,
    })
    const manifest = path.join(root, 'meta', 'manifest.json')

    await buildImages({
      source,
      destination,
      widths: [480, 1280],
      recursive: true,
      manifest,
    })

    const parsed = imageManifestSchema.parse(
      JSON.parse(await readFile(manifest, 'utf8')),
    )
    expect(parsed).toEqual({
      'nested/a.jpg': {
        width: 800,
        height: 600,
        variants: [
          { path: 'nested/a-480.webp', width: 480 },
          { path: 'nested/a-800.webp', width: 800 },
        ],
      },
    })
    expect(await listFiles(destination)).not.toContain('manifest.json')
  })

  it('fails clearly when the source does not exist', async () => {
    await expect(
      buildImages({ source: path.join(root, 'missing'), destination }),
    ).rejects.toThrow(ImageSourceError)
  })

  it('fails clearly when the source is not a supported image', async () => {
    const text = path.join(root, 'notes.txt')
    await writeFile(text, 'hello')
    await expect(buildImages({ source: text, destination })).rejects.toThrow(
      /not a supported image/,
    )
  })

  it('fails clearly when an image file cannot be decoded', async () => {
    const broken = path.join(root, 'broken.jpg')
    await writeFile(broken, 'not really a jpeg')
    await expect(buildImages({ source: broken, destination })).rejects.toThrow(
      ImageSourceError,
    )
  })

  it('refuses to write two sources to the same output file', async () => {
    await createImage(path.join(source, 'a.jpg'), { width: 500, height: 400 })
    await createImage(path.join(source, 'a.png'), {
      width: 500,
      height: 400,
      format: 'png',
    })

    await expect(
      buildImages({ source, destination, widths: [500] }),
    ).rejects.toThrow(OutputCollisionError)
    expect(await listFiles(root)).toEqual(['photos/a.jpg', 'photos/a.png'])
  })
})
