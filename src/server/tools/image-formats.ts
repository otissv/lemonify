const EXTENSIONS: Readonly<Record<string, string>> = {
  jpeg: '.jpg',
  png: '.png',
  webp: '.webp',
  gif: '.gif',
  avif: '.avif',
  heif: '.heif',
  tiff: '.tiff',
  jxl: '.jxl',
  jp2: '.jp2',
  raw: '.raw',
}

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  heif: 'image/heif',
  tiff: 'image/tiff',
  jxl: 'image/jxl',
  jp2: 'image/jp2',
  raw: 'application/octet-stream',
}

const GENERIC_MEDIA_TYPE = 'application/octet-stream'

/** The file extension for a format name Sharp reports, such as `jpeg`. */
export function extensionOfFormat(format: string): string {
  return EXTENSIONS[format] ?? `.${format}`
}

export function mediaTypeOfFormat(format: string): string {
  return MEDIA_TYPES[format] ?? GENERIC_MEDIA_TYPE
}

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  ...Object.values(EXTENSIONS),
  '.jpeg',
  '.jpe',
  '.tif',
])

/**
 * A file name for an image in `format`: the name without any image extension
 * it already has, then the format's extension. Other dots in the name stay.
 */
export function fileNameForFormat(name: string, format: string): string {
  const dot = name.lastIndexOf('.')
  const stem =
    dot > 0 && IMAGE_EXTENSIONS.has(name.slice(dot).toLowerCase())
      ? name.slice(0, dot)
      : name
  return `${stem}${extensionOfFormat(format)}`
}
