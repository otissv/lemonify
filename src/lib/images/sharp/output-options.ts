import { z } from 'zod'

import {
  colourSchema,
  nonNegativeIntSchema,
  positiveIntSchema,
  qualitySchema,
} from './common.ts'

/** Option objects for Sharp's output-format methods (`jpeg()`, `webp()`, …), keyed by format. */

const PNG_COMPRESSION_MAX = 9
const PALETTE_COLOURS_MIN = 2
const PALETTE_COLOURS_MAX = 256
const WEBP_EFFORT_MAX = 6
const HEIF_EFFORT_MAX = 9
const PALETTE_EFFORT_MAX = 10
const JXL_EFFORT_MAX = 9
const JXL_DISTANCE_MAX = 15
const JXL_DECODING_TIER_MAX = 4
const GIF_ERROR_MAX = 32

const base = { force: z.boolean().optional() }
const animation = {
  loop: nonNegativeIntSchema.optional(),
  delay: z
    .union([nonNegativeIntSchema, z.array(nonNegativeIntSchema)])
    .optional(),
}
const bitdepth = z.literal([8, 10, 12]).optional()
const heifTune = z.enum(['auto', 'iq', 'psnr', 'ssim']).optional()
const colours = z
  .number()
  .int()
  .min(PALETTE_COLOURS_MIN)
  .max(PALETTE_COLOURS_MAX)

export const OUTPUT_OPTION_SCHEMAS = {
  jpeg: z.strictObject({
    ...base,
    quality: qualitySchema.optional(),
    progressive: z.boolean().optional(),
    chromaSubsampling: z.enum(['4:2:0', '4:4:4']).optional(),
    trellisQuantisation: z.boolean().optional(),
    overshootDeringing: z.boolean().optional(),
    optimiseScans: z.boolean().optional(),
    optimizeScans: z.boolean().optional(),
    optimiseCoding: z.boolean().optional(),
    optimizeCoding: z.boolean().optional(),
    quantisationTable: z.number().int().min(0).max(8).optional(),
    quantizationTable: z.number().int().min(0).max(8).optional(),
    mozjpeg: z.boolean().optional(),
  }),
  png: z.strictObject({
    ...base,
    progressive: z.boolean().optional(),
    compressionLevel: z
      .number()
      .int()
      .min(0)
      .max(PNG_COMPRESSION_MAX)
      .optional(),
    adaptiveFiltering: z.boolean().optional(),
    quality: qualitySchema.optional(),
    effort: z.number().int().min(1).max(PALETTE_EFFORT_MAX).optional(),
    palette: z.boolean().optional(),
    colours: colours.optional(),
    colors: colours.optional(),
    dither: z.number().min(0).max(1).optional(),
  }),
  webp: z.strictObject({
    ...base,
    ...animation,
    quality: qualitySchema.optional(),
    alphaQuality: z.number().int().min(0).max(100).optional(),
    lossless: z.boolean().optional(),
    nearLossless: z.boolean().optional(),
    smartSubsample: z.boolean().optional(),
    smartDeblock: z.boolean().optional(),
    effort: z.number().int().min(0).max(WEBP_EFFORT_MAX).optional(),
    minSize: z.boolean().optional(),
    mixed: z.boolean().optional(),
    preset: z
      .enum(['default', 'picture', 'photo', 'drawing', 'icon', 'text'])
      .optional(),
    exact: z.boolean().optional(),
  }),
  gif: z.strictObject({
    ...base,
    ...animation,
    reuse: z.boolean().optional(),
    progressive: z.boolean().optional(),
    colours: colours.optional(),
    colors: colours.optional(),
    effort: z.number().int().min(1).max(PALETTE_EFFORT_MAX).optional(),
    dither: z.number().min(0).max(1).optional(),
    interFrameMaxError: z.number().min(0).max(GIF_ERROR_MAX).optional(),
    interPaletteMaxError: z
      .number()
      .min(0)
      .max(GIF_ERROR_MAX * 8)
      .optional(),
    keepDuplicateFrames: z.boolean().optional(),
  }),
  avif: z.strictObject({
    ...base,
    quality: qualitySchema.optional(),
    lossless: z.boolean().optional(),
    effort: z.number().int().min(0).max(HEIF_EFFORT_MAX).optional(),
    chromaSubsampling: z.enum(['4:2:0', '4:4:4']).optional(),
    bitdepth,
    tune: heifTune,
  }),
  heif: z.strictObject({
    ...base,
    quality: qualitySchema.optional(),
    compression: z.enum(['av1', 'hevc']).optional(),
    lossless: z.boolean().optional(),
    effort: z.number().int().min(0).max(HEIF_EFFORT_MAX).optional(),
    chromaSubsampling: z.enum(['4:2:0', '4:4:4']).optional(),
    bitdepth,
    tune: heifTune,
  }),
  tiff: z.strictObject({
    ...base,
    quality: qualitySchema.optional(),
    compression: z
      .enum([
        'none',
        'jpeg',
        'deflate',
        'packbits',
        'ccittfax4',
        'lzw',
        'webp',
        'zstd',
        'jp2k',
      ])
      .optional(),
    bigtiff: z.boolean().optional(),
    predictor: z.enum(['none', 'horizontal', 'float']).optional(),
    pyramid: z.boolean().optional(),
    tile: z.boolean().optional(),
    tileWidth: positiveIntSchema.optional(),
    tileHeight: positiveIntSchema.optional(),
    xres: z.number().positive().optional(),
    yres: z.number().positive().optional(),
    bitdepth: z.literal([1, 2, 4]).optional(),
    miniswhite: z.boolean().optional(),
    resolutionUnit: z.enum(['inch', 'cm']).optional(),
  }),
  jxl: z.strictObject({
    ...base,
    ...animation,
    distance: z.number().min(0).max(JXL_DISTANCE_MAX).optional(),
    quality: qualitySchema.optional(),
    decodingTier: z.number().int().min(0).max(JXL_DECODING_TIER_MAX).optional(),
    lossless: z.boolean().optional(),
    effort: z.number().int().min(1).max(JXL_EFFORT_MAX).optional(),
  }),
  jp2: z.strictObject({
    ...base,
    quality: qualitySchema.optional(),
    lossless: z.boolean().optional(),
    tileWidth: positiveIntSchema.optional(),
    tileHeight: positiveIntSchema.optional(),
    chromaSubsampling: z.enum(['4:4:4', '4:2:0']).optional(),
  }),
  raw: z.strictObject({
    ...base,
    depth: z
      .enum([
        'char',
        'uchar',
        'short',
        'ushort',
        'int',
        'uint',
        'float',
        'complex',
        'double',
        'dpcomplex',
      ])
      .optional(),
  }),
} as const

export type OutputFormat = keyof typeof OUTPUT_OPTION_SCHEMAS
export const OUTPUT_FORMATS = Object.keys(OUTPUT_OPTION_SCHEMAS) as [
  OutputFormat,
  ...OutputFormat[],
]

/** File extension used for an output format when a folder is converted. */
export const FORMAT_EXTENSIONS: Readonly<Record<OutputFormat, string>> = {
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

export const tileOptionsSchema = z.strictObject({
  size: positiveIntSchema.max(8192).optional(),
  overlap: nonNegativeIntSchema.max(8192).optional(),
  angle: z.literal([0, 90, 180, 270]).optional(),
  background: colourSchema.optional(),
  depth: z.enum(['onepixel', 'onetile', 'one']).optional(),
  skipBlanks: z.number().int().min(-1).max(65535).optional(),
  container: z.enum(['fs', 'zip']).optional(),
  layout: z.enum(['dz', 'iiif', 'iiif3', 'zoomify', 'google']).optional(),
  centre: z.boolean().optional(),
  center: z.boolean().optional(),
  id: z.string().optional(),
  basename: z.string().optional(),
})
