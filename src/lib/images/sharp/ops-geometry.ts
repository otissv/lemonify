import type { Sharp } from 'sharp'
import { z } from 'zod'

import {
  GRAVITIES,
  colourSchema,
  matrix2x2Schema,
  nonNegativeIntSchema,
  positiveIntSchema,
} from './common.ts'

const POSITIONS = [
  ...GRAVITIES,
  'entropy',
  'attention',
  'top',
  'right top',
  'right',
  'right bottom',
  'bottom',
  'left bottom',
  'left',
  'left top',
] as const

const KERNELS = [
  'nearest',
  'linear',
  'cubic',
  'mitchell',
  'lanczos2',
  'lanczos3',
  'mks2013',
  'mks2021',
] as const

const INTERPOLATORS = [
  'nearest',
  'bilinear',
  'bicubic',
  'lbb',
  'nohalo',
  'vsqbs',
] as const

const toggle = z
  .boolean()
  .optional()
  .describe('Defaults to true; false disables the operation')

export const geometryOpSchemas = [
  z.strictObject({
    op: z.literal('resize'),
    width: positiveIntSchema.optional(),
    height: positiveIntSchema.optional(),
    fit: z.enum(['contain', 'cover', 'fill', 'inside', 'outside']).optional(),
    position: z.union([z.enum(POSITIONS), nonNegativeIntSchema]).optional(),
    background: colourSchema.optional(),
    kernel: z.enum(KERNELS).optional(),
    withoutEnlargement: z.boolean().optional(),
    withoutReduction: z.boolean().optional(),
    fastShrinkOnLoad: z.boolean().optional(),
  }),
  z.strictObject({
    op: z.literal('extend'),
    top: nonNegativeIntSchema.optional(),
    left: nonNegativeIntSchema.optional(),
    bottom: nonNegativeIntSchema.optional(),
    right: nonNegativeIntSchema.optional(),
    background: colourSchema.optional(),
    extendWith: z.enum(['background', 'copy', 'repeat', 'mirror']).optional(),
  }),
  z.strictObject({
    op: z.literal('extract'),
    left: nonNegativeIntSchema,
    top: nonNegativeIntSchema,
    width: positiveIntSchema,
    height: positiveIntSchema,
  }),
  z.strictObject({
    op: z.literal('trim'),
    background: colourSchema.optional(),
    threshold: z.number().nonnegative().optional(),
    lineArt: z.boolean().optional(),
    margin: nonNegativeIntSchema.optional(),
  }),
  z.strictObject({
    op: z.literal('rotate'),
    angle: z.number().optional(),
    background: colourSchema.optional(),
  }),
  z.strictObject({ op: z.literal('autoOrient') }),
  z.strictObject({ op: z.literal('flip'), enabled: toggle }),
  z.strictObject({ op: z.literal('flop'), enabled: toggle }),
  z.strictObject({
    op: z.literal('affine'),
    matrix: matrix2x2Schema,
    background: colourSchema.optional(),
    idx: z.number().optional(),
    idy: z.number().optional(),
    odx: z.number().optional(),
    ody: z.number().optional(),
    interpolator: z.enum(INTERPOLATORS).optional(),
  }),
] as const

export type GeometryOp = z.infer<(typeof geometryOpSchemas)[number]>

export function applyGeometryOp(image: Sharp, step: GeometryOp): Sharp {
  switch (step.op) {
    case 'resize': {
      const { op: _op, ...options } = step
      return image.resize(options)
    }
    case 'extend': {
      const { op: _op, ...options } = step
      return image.extend(options)
    }
    case 'extract': {
      const { op: _op, ...region } = step
      return image.extract(region)
    }
    case 'trim': {
      const { op: _op, ...options } = step
      return image.trim(options)
    }
    case 'rotate':
      return image.rotate(step.angle, { background: step.background })
    case 'autoOrient':
      return image.autoOrient()
    case 'flip':
      return image.flip(step.enabled)
    case 'flop':
      return image.flop(step.enabled)
    case 'affine': {
      const { op: _op, matrix, ...options } = step
      return image.affine(matrix, options)
    }
  }
}
