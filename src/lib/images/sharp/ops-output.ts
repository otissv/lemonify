import type { Sharp } from 'sharp'
import { z } from 'zod'

import { exifSchema, nonNegativeIntSchema } from './common.ts'
import {
  OUTPUT_FORMATS,
  OUTPUT_OPTION_SCHEMAS,
  tileOptionsSchema,
} from './output-options.ts'

const ORIENTATION_MAX = 8
const formats = OUTPUT_OPTION_SCHEMAS

const toFormatSchema = z
  .strictObject({
    op: z.literal('toFormat'),
    format: z.enum(OUTPUT_FORMATS),
    options: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('The same options as the op named after the format'),
  })
  .superRefine((step, context) => {
    const result = OUTPUT_OPTION_SCHEMAS[step.format].safeParse(
      step.options ?? {},
    )
    if (result.success) return
    for (const issue of result.error.issues) {
      context.addIssue({
        code: 'custom',
        message: issue.message,
        path: ['options', ...issue.path.map(String)],
      })
    }
  })

export const outputOpSchemas = [
  formats.jpeg.extend({ op: z.literal('jpeg') }),
  formats.png.extend({ op: z.literal('png') }),
  formats.webp.extend({ op: z.literal('webp') }),
  formats.gif.extend({ op: z.literal('gif') }),
  formats.avif.extend({ op: z.literal('avif') }),
  formats.heif.extend({ op: z.literal('heif') }),
  formats.tiff.extend({ op: z.literal('tiff') }),
  formats.jxl.extend({ op: z.literal('jxl') }),
  formats.jp2.extend({ op: z.literal('jp2') }),
  formats.raw.extend({ op: z.literal('raw') }),
  toFormatSchema,
  tileOptionsSchema.extend({ op: z.literal('tile') }),
  z.strictObject({ op: z.literal('timeout'), seconds: nonNegativeIntSchema }),
  z.strictObject({ op: z.literal('keepMetadata') }),
  z.strictObject({ op: z.literal('keepExif') }),
  z.strictObject({ op: z.literal('withExif'), exif: exifSchema }),
  z.strictObject({ op: z.literal('withExifMerge'), exif: exifSchema }),
  z.strictObject({ op: z.literal('keepIccProfile') }),
  z.strictObject({
    op: z.literal('withIccProfile'),
    icc: z
      .string()
      .min(1)
      .describe('A built-in profile name or an ICC file path'),
    attach: z.boolean().optional(),
  }),
  z.strictObject({ op: z.literal('keepXmp') }),
  z.strictObject({ op: z.literal('withXmp'), xmp: z.string().min(1) }),
  z.strictObject({
    op: z.literal('withMetadata'),
    density: z.number().positive().optional(),
    orientation: z.number().int().min(1).max(ORIENTATION_MAX).optional(),
    icc: z.string().min(1).optional(),
    exif: exifSchema.optional(),
  }),
  z.strictObject({
    op: z.literal('withDensity'),
    density: z.number().positive(),
  }),
] as const

export type OutputOp = z.infer<(typeof outputOpSchemas)[number]>
type FormatOp = Extract<OutputOp, { op: (typeof OUTPUT_FORMATS)[number] }>
type MetadataOp = Exclude<
  OutputOp,
  FormatOp | { op: 'toFormat' | 'tile' | 'timeout' }
>

function applyFormatOp(image: Sharp, step: FormatOp): Sharp {
  switch (step.op) {
    case 'jpeg': {
      const { op: _op, ...options } = step
      return image.jpeg(options)
    }
    case 'png': {
      const { op: _op, ...options } = step
      return image.png(options)
    }
    case 'webp': {
      const { op: _op, ...options } = step
      return image.webp(options)
    }
    case 'gif': {
      const { op: _op, ...options } = step
      return image.gif(options)
    }
    case 'avif': {
      const { op: _op, ...options } = step
      return image.avif(options)
    }
    case 'heif': {
      const { op: _op, ...options } = step
      return image.heif(options)
    }
    case 'tiff': {
      const { op: _op, ...options } = step
      return image.tiff(options)
    }
    case 'jxl': {
      const { op: _op, ...options } = step
      return image.jxl(options)
    }
    case 'jp2': {
      const { op: _op, ...options } = step
      return image.jp2(options)
    }
    case 'raw': {
      const { op: _op, ...options } = step
      return image.raw(options)
    }
  }
}

function applyMetadataOp(image: Sharp, step: MetadataOp): Sharp {
  switch (step.op) {
    case 'keepMetadata':
      return image.keepMetadata()
    case 'keepExif':
      return image.keepExif()
    case 'withExif':
      return image.withExif(step.exif)
    case 'withExifMerge':
      return image.withExifMerge(step.exif)
    case 'keepIccProfile':
      return image.keepIccProfile()
    case 'withIccProfile':
      return image.withIccProfile(step.icc, { attach: step.attach })
    case 'keepXmp':
      return image.keepXmp()
    case 'withXmp':
      return image.withXmp(step.xmp)
    case 'withMetadata': {
      const { op: _op, ...metadata } = step
      return image.withMetadata(metadata)
    }
    case 'withDensity':
      return image.withDensity(step.density)
  }
}

export function applyOutputOp(image: Sharp, step: OutputOp): Sharp {
  switch (step.op) {
    case 'toFormat':
      return image.toFormat(
        step.format,
        OUTPUT_OPTION_SCHEMAS[step.format].parse(step.options ?? {}),
      )
    case 'tile': {
      const { op: _op, ...options } = step
      return image.tile(options)
    }
    case 'timeout':
      return image.timeout({ seconds: step.seconds })
    case 'jpeg':
    case 'png':
    case 'webp':
    case 'gif':
    case 'avif':
    case 'heif':
    case 'tiff':
    case 'jxl':
    case 'jp2':
    case 'raw':
      return applyFormatOp(image, step)
    default:
      return applyMetadataOp(image, step)
  }
}
