import sharp from 'sharp'
import type { Metadata } from 'sharp'

import { ValidationError } from '../errors.ts'

/** The image types the app takes as Sources: the ones every current browser can show. */
export const SOURCE_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/gif',
] as const

export type SourceMediaType = (typeof SOURCE_MEDIA_TYPES)[number]

export function isSourceMediaType(value: string): value is SourceMediaType {
  return SOURCE_MEDIA_TYPES.some((type) => type === value)
}

export type ImageInfo = {
  mediaType: SourceMediaType
  width: number
  height: number
}

/** Reads what an uploaded file really is, whatever its name or declared type says. */
export interface ImageInspector {
  inspect(file: string): Promise<ImageInfo>
}

const FIRST_ROTATED_ORIENTATION = 5
const NOT_AN_IMAGE =
  'That file is not an image the app can open. Use PNG, JPEG, WebP, AVIF or GIF.'

function mediaTypeOf(
  format: string | undefined,
  compression?: string,
): SourceMediaType | undefined {
  switch (format) {
    case 'png':
      return 'image/png'
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'heif':
      return compression === 'av1' ? 'image/avif' : undefined
    default:
      return undefined
  }
}

export class SharpImageInspector implements ImageInspector {
  async inspect(file: string): Promise<ImageInfo> {
    let metadata: Metadata
    try {
      metadata = await sharp(file).metadata()
    } catch (error) {
      throw new ValidationError(NOT_AN_IMAGE, { cause: error })
    }
    const mediaType = mediaTypeOf(metadata.format, metadata.compression)
    const { width, height, orientation } = metadata
    if (mediaType === undefined || !width || !height) {
      throw new ValidationError(NOT_AN_IMAGE)
    }
    const rotated = (orientation ?? 1) >= FIRST_ROTATED_ORIENTATION
    return rotated
      ? { mediaType, width: height, height: width }
      : { mediaType, width, height }
  }
}
