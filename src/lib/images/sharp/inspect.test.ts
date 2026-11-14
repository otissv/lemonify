// @vitest-environment node
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createTempDir, removeDir } from '@/test/image-fixtures.ts'

import { describeCapabilities } from './capabilities.ts'
import { inspectImages } from './inspect.ts'

describe('inspectImages', () => {
  let root = ''

  beforeEach(async () => {
    root = await createTempDir('inspect')
  })

  afterEach(async () => {
    await removeDir(root)
  })

  it('returns JSON-safe metadata with binary blocks reduced to byte counts', async () => {
    const file = path.join(root, 'photo.jpg')
    await sharp({
      create: { width: 12, height: 8, channels: 3, background: '#123456' },
    })
      .withExif({ IFD0: { Copyright: 'Lemonify' } })
      .jpeg()
      .toFile(file)

    const [result] = await inspectImages({ source: file })

    expect(result).toMatchObject({
      file,
      metadata: { format: 'jpeg', width: 12, height: 8, space: 'srgb' },
    })
    expect(result.metadata.exif).toEqual({ bytes: expect.any(Number) })
    expect(result.stats).toBeUndefined()
    expect(() => JSON.stringify(result)).not.toThrow()
  })

  it('adds pixel statistics on request', async () => {
    const file = path.join(root, 'flat.png')
    await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#ff0000' },
    })
      .png()
      .toFile(file)

    const [result] = await inspectImages({ source: file, stats: true })

    expect(result.stats).toMatchObject({
      isOpaque: true,
      dominant: { r: expect.any(Number), g: expect.any(Number) },
    })
  })

  it('inspects every image in a folder, including formats beyond the resize set', async () => {
    await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#000' },
    })
      .gif()
      .toFile(path.join(root, 'a.gif'))
    await sharp({
      create: { width: 3, height: 3, channels: 3, background: '#000' },
    })
      .tiff()
      .toFile(path.join(root, 'b.tiff'))

    const results = await inspectImages({ source: root })

    const formats: string[] = []
    for (const result of results) formats.push(result.metadata.format)
    expect(formats).toEqual(['gif', 'tiff'])
  })
})

describe('describeCapabilities', () => {
  it('lists Sharp and libvips versions and per-format support', () => {
    const capabilities = describeCapabilities()

    expect(capabilities.versions).toHaveProperty('sharp')
    expect(capabilities.formats).toContainEqual(
      expect.objectContaining({
        id: 'webp',
        input: expect.objectContaining({ file: true }),
        output: expect.objectContaining({ file: true }),
      }),
    )
  })
})
