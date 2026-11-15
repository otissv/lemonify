import { z } from 'zod'

export enum ExportFormat {
  Original = 'original',
  Jpeg = 'jpeg',
  Png = 'png',
  Webp = 'webp',
  Gif = 'gif',
  Avif = 'avif',
  Heif = 'heif',
  Tiff = 'tiff',
  Jxl = 'jxl',
  Jp2 = 'jp2',
  Raw = 'raw',
}

export type ConvertedFormat = Exclude<ExportFormat, ExportFormat.Original>

export const MAX_NAME_LENGTH = 255

export const EXPORT_FORMAT_LABELS: Readonly<Record<ExportFormat, string>> = {
  [ExportFormat.Original]: 'Same as original',
  [ExportFormat.Jpeg]: 'JPEG',
  [ExportFormat.Png]: 'PNG',
  [ExportFormat.Webp]: 'WebP',
  [ExportFormat.Gif]: 'GIF',
  [ExportFormat.Avif]: 'AVIF',
  [ExportFormat.Heif]: 'HEIF',
  [ExportFormat.Tiff]: 'TIFF',
  [ExportFormat.Jxl]: 'JPEG XL',
  [ExportFormat.Jp2]: 'JPEG 2000',
  [ExportFormat.Raw]: 'Raw pixels',
}

export const EXPORT_EXTENSIONS: Readonly<Record<ConvertedFormat, string>> = {
  [ExportFormat.Jpeg]: '.jpg',
  [ExportFormat.Png]: '.png',
  [ExportFormat.Webp]: '.webp',
  [ExportFormat.Gif]: '.gif',
  [ExportFormat.Avif]: '.avif',
  [ExportFormat.Heif]: '.heif',
  [ExportFormat.Tiff]: '.tiff',
  [ExportFormat.Jxl]: '.jxl',
  [ExportFormat.Jp2]: '.jp2',
  [ExportFormat.Raw]: '.raw',
}

const OptionValueSchema = z.union([z.number(), z.boolean(), z.string()])

export type ExportOptionValue = z.infer<typeof OptionValueSchema>

export const ExportSettingsSchema = z.object({
  format: z.enum(ExportFormat),
  /** The chosen format's own options; the server checks them against Sharp's schema for it. */
  options: z.record(z.string(), OptionValueSchema),
  keepMetadata: z.boolean(),
})

export type ExportSettings = z.infer<typeof ExportSettingsSchema>

interface FieldBase {
  name: string
  label: string
  /** Shown only while the named option has one of these values. */
  visibleWhen?: { name: string; oneOf: ReadonlyArray<ExportOptionValue> }
}

export type ExportField =
  | (FieldBase & {
      kind: 'slider'
      min: number
      max: number
      step: number
      default: number
    })
  | (FieldBase & { kind: 'switch'; default: boolean })
  | (FieldBase & {
      kind: 'select'
      choices: ReadonlyArray<string>
      default: string
    })

const QUALITY_MIN = 1
const QUALITY_MAX = 100
const NOT_LOSSLESS = { name: 'lossless', oneOf: [false] } as const
const SUBSAMPLING = ['4:2:0', '4:4:4']
const LOSSY_TIFF = ['jpeg', 'webp', 'jp2k']

function quality(value: number, lossless = false): ExportField {
  return {
    kind: 'slider',
    name: 'quality',
    label: 'Quality',
    min: QUALITY_MIN,
    max: QUALITY_MAX,
    step: 1,
    default: value,
    visibleWhen: lossless ? NOT_LOSSLESS : undefined,
  }
}

function effort(max: number, value: number, min = 0): ExportField {
  return {
    kind: 'slider',
    name: 'effort',
    label: 'Effort',
    min,
    max,
    step: 1,
    default: value,
  }
}

const LOSSLESS: ExportField = {
  kind: 'switch',
  name: 'lossless',
  label: 'Lossless',
  default: false,
}

/**
 * The options each format offers in the Export panel. Names and ranges are
 * Sharp's own (checked against the image CLI's schema in the tests); the
 * panel shows only the fields of the chosen format.
 */
export const EXPORT_FIELDS: Readonly<
  Record<ExportFormat, ReadonlyArray<ExportField>>
> = {
  [ExportFormat.Original]: [],
  [ExportFormat.Jpeg]: [
    quality(85),
    { kind: 'switch', name: 'mozjpeg', label: 'Smaller file', default: true },
    {
      kind: 'switch',
      name: 'progressive',
      label: 'Progressive',
      default: false,
    },
    {
      kind: 'select',
      name: 'chromaSubsampling',
      label: 'Chroma subsampling',
      choices: SUBSAMPLING,
      default: '4:2:0',
    },
  ],
  [ExportFormat.Png]: [
    {
      kind: 'slider',
      name: 'compressionLevel',
      label: 'Compression',
      min: 0,
      max: 9,
      step: 1,
      default: 6,
    },
    {
      kind: 'switch',
      name: 'progressive',
      label: 'Interlaced',
      default: false,
    },
    {
      kind: 'switch',
      name: 'palette',
      label: 'Reduce to a palette',
      default: false,
    },
  ],
  [ExportFormat.Webp]: [LOSSLESS, quality(85, true), effort(6, 4)],
  [ExportFormat.Gif]: [
    {
      kind: 'slider',
      name: 'colours',
      label: 'Colours',
      min: 2,
      max: 256,
      step: 1,
      default: 256,
    },
    {
      kind: 'slider',
      name: 'dither',
      label: 'Dithering',
      min: 0,
      max: 1,
      step: 0.05,
      default: 1,
    },
    effort(10, 7, 1),
  ],
  [ExportFormat.Avif]: [
    LOSSLESS,
    quality(60, true),
    effort(9, 4),
    {
      kind: 'select',
      name: 'chromaSubsampling',
      label: 'Chroma subsampling',
      choices: SUBSAMPLING,
      default: '4:4:4',
    },
  ],
  [ExportFormat.Heif]: [
    {
      kind: 'select',
      name: 'compression',
      label: 'Compression',
      choices: ['av1', 'hevc'],
      default: 'av1',
    },
    LOSSLESS,
    quality(80, true),
    effort(9, 4),
  ],
  [ExportFormat.Tiff]: [
    {
      kind: 'select',
      name: 'compression',
      label: 'Compression',
      choices: [
        'jpeg',
        'deflate',
        'lzw',
        'zstd',
        'packbits',
        'none',
        'webp',
        'jp2k',
        'ccittfax4',
      ],
      default: 'jpeg',
    },
    {
      ...quality(80),
      visibleWhen: { name: 'compression', oneOf: LOSSY_TIFF },
    },
    { kind: 'switch', name: 'bigtiff', label: 'BigTIFF', default: false },
  ],
  [ExportFormat.Jxl]: [LOSSLESS, quality(80, true), effort(9, 7, 1)],
  [ExportFormat.Jp2]: [LOSSLESS, quality(80, true)],
  [ExportFormat.Raw]: [
    {
      kind: 'select',
      name: 'depth',
      label: 'Depth',
      choices: [
        'uchar',
        'char',
        'ushort',
        'short',
        'uint',
        'int',
        'float',
        'double',
      ],
      default: 'uchar',
    },
  ],
}

/** The fields of `format` that apply to `options`, e.g. no Quality once Lossless is on. */
export function visibleExportFields(
  format: ExportFormat,
  options: Readonly<Record<string, ExportOptionValue>>,
): Array<ExportField> {
  const visible: Array<ExportField> = []
  for (const field of EXPORT_FIELDS[format]) {
    const { visibleWhen } = field
    const value = visibleWhen ? options[visibleWhen.name] : undefined
    if (
      !visibleWhen ||
      (value !== undefined && visibleWhen.oneOf.includes(value))
    )
      visible.push(field)
  }
  return visible
}

/** Every option of `format` at its default. */
export function defaultExportOptions(
  format: ExportFormat,
): Record<string, ExportOptionValue> {
  const options: Record<string, ExportOptionValue> = {}
  for (const field of EXPORT_FIELDS[format]) options[field.name] = field.default
  return options
}

/** Export settings for a format, with its options at their defaults. */
export function defaultExportSettings(format: ExportFormat): ExportSettings {
  return {
    format,
    options: defaultExportOptions(format),
    keepMetadata: false,
  }
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = defaultExportSettings(
  ExportFormat.Original,
)

/** `name` with the extension of `format`, e.g. me.jpg → me.webp. */
export function exportFileName(name: string, format: ExportFormat): string {
  if (format === ExportFormat.Original) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  return `${stem}${EXPORT_EXTENSIONS[format]}`
}
