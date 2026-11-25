import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'

import sharp from 'sharp'

import { ValidationError } from '../../src/server/errors.ts'
import { cropBox } from './region.ts'
import type { Region } from './region.ts'
import { writeAtomically } from './save-result.ts'

const PICTURE_FORMATS = {
  '.webp': 'webp',
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
} as const

export type PictureFormat =
  (typeof PICTURE_FORMATS)[keyof typeof PICTURE_FORMATS]

/** Previews are made as WebP, so that is what is written when nothing asks otherwise. */
const NATIVE_FORMAT: PictureFormat = 'webp'
const NAME_UNSAFE = /[\\/:*?"<>|\0]/g

export type PictureShape = {
  /** Only this part of the picture, taken before it is shrunk. */
  region?: Region
  /** Shrink the picture to this width; it is never made larger. */
  width?: number
}

export type WrittenPicture = {
  path: string
  bytes: number
  format: PictureFormat
}

/** The type of file `destination` names, or undefined for a folder; refuses a type a picture cannot be written as, so a bad path fails before any render. */
export function formatFor(destination: string): PictureFormat | undefined {
  const extension = path.extname(destination).toLowerCase()
  if (extension === '') return undefined
  const format = (PICTURE_FORMATS as Record<string, PictureFormat>)[extension]
  if (format === undefined) {
    throw new ValidationError(
      `Write the picture as ${Object.keys(PICTURE_FORMATS).join(', ')}.`,
    )
  }
  return format
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function reshaped(
  stream: Readable,
  format: PictureFormat,
  shape: PictureShape,
): Promise<Readable> {
  let image = sharp(await collect(stream))
  if (shape.region !== undefined) {
    const { width, height } = await image.metadata()
    if (width === undefined || height === undefined) {
      throw new Error('The picture has no size to take a region of.')
    }
    image = sharp(await image.toBuffer()).extract(
      cropBox(shape.region, width, height),
    )
  }
  if (shape.width !== undefined) {
    image = image.resize({ width: shape.width, withoutEnlargement: true })
  }
  return Readable.from(await image.toFormat(format).toBuffer())
}

/**
 * Writes a picture to `destination`, in the type of file its extension names;
 * a folder gets `name` with the extension of the type written. A rendered
 * preview (`rendered`, which is WebP) is copied as it is when nothing asks to
 * change it.
 */
export async function writePicture(
  picture: { stream: Readable; rendered: boolean },
  destination: string,
  name: string,
  shape: PictureShape = {},
): Promise<WrittenPicture> {
  const format = formatFor(destination) ?? NATIVE_FORMAT
  const unchanged =
    picture.rendered &&
    format === NATIVE_FORMAT &&
    shape.width === undefined &&
    shape.region === undefined
  const content = unchanged
    ? picture.stream
    : await reshaped(picture.stream, format, shape)
  const written = await writeAtomically(
    destination,
    `${name.replace(NAME_UNSAFE, '_')}.${format === 'jpeg' ? 'jpg' : format}`,
    content,
  )
  const { size } = await stat(written)
  return { path: written, bytes: size, format }
}
