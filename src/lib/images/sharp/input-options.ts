import { z } from 'zod'

import {
  colourSchema,
  filePathSchema,
  gravitySchema,
  nonNegativeIntSchema,
  positiveIntSchema,
  rawInputSchema,
} from './common.ts'

const ALIGNMENTS = ['left', 'centre', 'center', 'right'] as const
const VERTICAL_ALIGNMENTS = ['top', 'centre', 'center', 'bottom'] as const

export const createInputSchema = z.strictObject({
  width: positiveIntSchema,
  height: positiveIntSchema,
  channels: z.literal([3, 4]),
  background: colourSchema,
  noise: z
    .strictObject({
      type: z.literal('gaussian'),
      mean: z.number().optional(),
      sigma: z.number().optional(),
    })
    .optional(),
  pageHeight: positiveIntSchema.optional(),
})

export const textInputSchema = z.strictObject({
  text: z.string().min(1),
  font: z.string().optional(),
  fontfile: filePathSchema.optional(),
  width: positiveIntSchema.optional(),
  height: positiveIntSchema.optional(),
  align: z.enum(ALIGNMENTS).optional(),
  justify: z.boolean().optional(),
  dpi: positiveIntSchema.optional(),
  rgba: z.boolean().optional(),
  spacing: z.number().int().optional(),
  wrap: z.enum(['word', 'char', 'word-char', 'none']).optional(),
})

export const joinInputSchema = z.strictObject({
  across: positiveIntSchema.optional(),
  animated: z.boolean().optional(),
  shim: nonNegativeIntSchema.optional(),
  background: colourSchema.optional(),
  halign: z.enum(ALIGNMENTS).optional(),
  valign: z.enum(VERTICAL_ALIGNMENTS).optional(),
})

const limitSchema = z.union([positiveIntSchema, z.boolean()])

/** Options for reading an image, as passed to `sharp(input, options)`. */
export const sharpInputOptionsSchema = z.strictObject({
  autoOrient: z.boolean().optional(),
  failOn: z.enum(['none', 'truncated', 'error', 'warning']).optional(),
  limitInputPixels: limitSchema.optional(),
  limitInputChannels: limitSchema.optional(),
  unlimited: z.boolean().optional(),
  sequentialRead: z.boolean().optional(),
  density: z.number().positive().max(100_000).optional(),
  ignoreIcc: z.boolean().optional(),
  pages: z.number().int().min(-1).optional(),
  page: nonNegativeIntSchema.optional(),
  tiff: z
    .strictObject({ subifd: z.number().int().min(-1).optional() })
    .optional(),
  svg: z
    .strictObject({
      stylesheet: z.string().optional(),
      highBitdepth: z.boolean().optional(),
    })
    .optional(),
  pdf: z.strictObject({ background: colourSchema.optional() }).optional(),
  openSlide: z
    .strictObject({ level: nonNegativeIntSchema.optional() })
    .optional(),
  jp2: z.strictObject({ oneshot: z.boolean().optional() }).optional(),
  subifd: z.number().int().min(-1).optional(),
  pdfBackground: colourSchema.optional(),
  level: nonNegativeIntSchema.optional(),
  animated: z.boolean().optional(),
  raw: rawInputSchema.optional(),
  create: createInputSchema.optional(),
  text: textInputSchema.optional(),
  join: joinInputSchema.optional(),
})
export type SharpInputOptions = z.infer<typeof sharpInputOptionsSchema>

export const BLEND_MODES = [
  'clear',
  'source',
  'over',
  'in',
  'out',
  'atop',
  'dest',
  'dest-over',
  'dest-in',
  'dest-out',
  'dest-atop',
  'xor',
  'add',
  'saturate',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'colour-dodge',
  'color-burn',
  'colour-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
] as const

/** One layer for the `composite` op; `input` is a file, or a generated `create`/`text` image. */
export const overlaySchema = sharpInputOptionsSchema
  .omit({ create: true, text: true, join: true })
  .extend({
    input: z.union([
      filePathSchema,
      z.strictObject({ create: createInputSchema }),
      z.strictObject({ text: textInputSchema }),
    ]),
    blend: z.enum(BLEND_MODES).optional(),
    gravity: gravitySchema.optional(),
    top: z.number().int().optional(),
    left: z.number().int().optional(),
    tile: z.boolean().optional(),
    premultiplied: z.boolean().optional(),
  })
