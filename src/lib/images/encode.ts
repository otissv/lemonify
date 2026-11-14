import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { Sharp } from 'sharp'

import { ImageSourceError } from './errors.ts'
import type { ImageFormat } from './options.ts'

/** A file path or the image's bytes, so a server function can pass an upload. */
export type ImageInput = string | Buffer

export interface ImageSize {
  width: number
  height: number
}

export interface EncodeOptions {
  /** Target width; the image is never enlarged past its own width. */
  width: number
  format: ImageFormat
  quality: number
}

type Encoder = (image: Sharp, quality: number) => Sharp

const PNG_COMPRESSION_LEVEL = 9

const ENCODERS: Readonly<Record<ImageFormat, Encoder>> = {
  webp: (image, quality) => image.webp({ quality }),
  avif: (image, quality) => image.avif({ quality }),
  jpeg: (image, quality) => image.jpeg({ quality, mozjpeg: true }),
  png: (image, quality) =>
    image.png({
      quality,
      palette: true,
      compressionLevel: PNG_COMPRESSION_LEVEL,
    }),
}

function describe(input: ImageInput): string {
  return typeof input === 'string' ? input : '<buffer>'
}

/** Width and height after EXIF orientation is applied. */
export async function readOrientedSize(
  input: ImageInput,
  label: string = describe(input),
): Promise<ImageSize> {
  try {
    const { autoOrient } = await sharp(input).metadata()
    return { width: autoOrient.width, height: autoOrient.height }
  } catch (error) {
    throw new ImageSourceError(label, 'it could not be decoded as an image', {
      cause: error,
    })
  }
}

/** Applies EXIF orientation, resizes to `width` without enlarging, and encodes. */
export async function encodeImage(
  input: ImageInput,
  options: EncodeOptions,
  label: string = describe(input),
): Promise<Buffer> {
  const resized = sharp(input)
    .autoOrient()
    .resize({ width: options.width, withoutEnlargement: true })
  try {
    return await ENCODERS[options.format](resized, options.quality).toBuffer()
  } catch (error) {
    throw new ImageSourceError(label, 'it could not be encoded', {
      cause: error,
    })
  }
}

/** Writes `data` to `file`, creating parent folders. Never deletes anything. */
export async function writeOutput(file: string, data: Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, data)
}
