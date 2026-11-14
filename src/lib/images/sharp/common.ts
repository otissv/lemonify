import { z } from 'zod'

/**
 * Building blocks shared by the Sharp input-option and operation schemas.
 * Field names and enum values mirror Sharp's own option objects, so a job
 * written against Sharp's documentation validates here unchanged.
 */

const BYTE_MAX = 255

export const filePathSchema = z
  .string({ error: 'A path is required' })
  .trim()
  .min(1, { error: 'A path is required' })

export const positiveIntSchema = z.number().int().positive()
export const nonNegativeIntSchema = z.number().int().nonnegative()
export const unitIntervalSchema = z.number().min(0).max(1)
export const qualitySchema = z.number().int().min(1).max(100)

const rgbChannelSchema = z.number().min(0).max(BYTE_MAX)

export const colourSchema = z
  .union([
    z.string().trim().min(1),
    z.strictObject({
      r: rgbChannelSchema,
      g: rgbChannelSchema,
      b: rgbChannelSchema,
      alpha: unitIntervalSchema.optional(),
    }),
  ])
  .describe('A CSS colour string such as "#ff000080", or { r, g, b, alpha }')

export const channelCountSchema = z.literal([1, 2, 3, 4])

export const COLOURSPACES = [
  'b-w',
  'cmc',
  'cmyk',
  'fourier',
  'grey16',
  'histogram',
  'hsv',
  'lab',
  'labq',
  'labs',
  'lch',
  'matrix',
  'multiband',
  'rgb',
  'rgb16',
  'scrgb',
  'srgb',
  'xyz',
  'yxy',
] as const
export const colourspaceSchema = z.enum(COLOURSPACES)

export const boolOperatorSchema = z.enum(['and', 'or', 'eor'])

export const GRAVITIES = [
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
  'center',
  'centre',
] as const
export const gravitySchema = z.union([z.enum(GRAVITIES), nonNegativeIntSchema])

const exifDirectorySchema = z.record(z.string(), z.string())
export const exifSchema = z.strictObject({
  IFD0: exifDirectorySchema.optional(),
  IFD1: exifDirectorySchema.optional(),
  IFD2: exifDirectorySchema.optional(),
  IFD3: exifDirectorySchema.optional(),
})

export const rawInputSchema = z.strictObject({
  width: positiveIntSchema,
  height: positiveIntSchema,
  channels: channelCountSchema,
  premultiplied: z.boolean().optional(),
  pageHeight: positiveIntSchema.optional(),
})

const finite = z.number()
export const matrix2x2Schema = z.union([
  z.tuple([finite, finite, finite, finite]),
  z.tuple([z.tuple([finite, finite]), z.tuple([finite, finite])]),
])
const row3 = z.tuple([finite, finite, finite])
const row4 = z.tuple([finite, finite, finite, finite])
export const recombMatrixSchema = z.union([
  z.tuple([row3, row3, row3]),
  z.tuple([row4, row4, row4, row4]),
])
