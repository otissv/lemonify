import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ValidationError } from '../errors'
import { SharpImageInspector } from './image-inspector'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'lemonify-inspect-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

async function image(
  name: string,
  format: 'png' | 'jpeg' | 'webp' | 'gif',
  width = 4,
  height = 3,
): Promise<string> {
  const file = path.join(dir, name)
  await sharp({ create: { width, height, channels: 3, background: '#f00' } })
    .toFormat(format)
    .toFile(file)
  return file
}

describe('SharpImageInspector', () => {
  const inspector = new SharpImageInspector()

  it.each([
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp'],
    ['gif', 'image/gif'],
  ] as const)(
    'reads a %s from its content, not its name',
    async (format, mediaType) => {
      const file = await image('picture.bin', format)
      expect(await inspector.inspect(file)).toEqual({
        mediaType,
        width: 4,
        height: 3,
      })
    },
  )

  it('swaps width and height for a rotated EXIF orientation', async () => {
    const file = path.join(dir, 'rotated.jpg')
    await sharp({
      create: { width: 4, height: 3, channels: 3, background: '#0f0' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toFile(file)
    expect(await inspector.inspect(file)).toMatchObject({ width: 3, height: 4 })
  })

  it('refuses a file that is not an image, in plain words', async () => {
    const file = path.join(dir, 'notes.png')
    writeFileSync(file, 'definitely not a png')
    await expect(inspector.inspect(file)).rejects.toThrow(ValidationError)
    await expect(inspector.inspect(file)).rejects.toThrow(/not an image/)
  })

  it('refuses an image type browsers cannot show', async () => {
    const file = path.join(dir, 'scan.tiff')
    await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#00f' },
    })
      .tiff()
      .toFile(file)
    await expect(inspector.inspect(file)).rejects.toThrow(
      /PNG, JPEG, WebP, AVIF or GIF/,
    )
  })
})
