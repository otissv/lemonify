import type { Sharp } from 'sharp'
import { z } from 'zod'

import {
  boolOperatorSchema,
  colourSchema,
  filePathSchema,
  positiveIntSchema,
  rawInputSchema,
  recombMatrixSchema,
} from './common.ts'

const GAMMA_MIN = 1
const GAMMA_MAX = 3
const BLUR_SIGMA_MIN = 0.3
const BLUR_SIGMA_MAX = 1000
const SHARPEN_SIGMA_MIN = 0.000001
const SHARPEN_SIGMA_MAX = 10
const THRESHOLD_MAX = 255
const CLAHE_SLOPE_MAX = 100
const PERCENTILE_MAX = 100

const linearValueSchema = z.union([z.number(), z.array(z.number()).min(1)])

const sharpenSchema = z
  .strictObject({
    op: z.literal('sharpen'),
    sigma: z.number().min(SHARPEN_SIGMA_MIN).max(SHARPEN_SIGMA_MAX).optional(),
    m1: z.number().nonnegative().optional(),
    m2: z.number().nonnegative().optional(),
    x1: z.number().nonnegative().optional(),
    y2: z.number().nonnegative().optional(),
    y3: z.number().nonnegative().optional(),
  })
  .refine(
    (step) =>
      step.sigma !== undefined ||
      [step.m1, step.m2, step.x1, step.y2, step.y3].every(
        (value) => value === undefined,
      ),
    { error: 'sharpen needs sigma when m1, m2, x1, y2 or y3 is set' },
  )

const blurSchema = z
  .strictObject({
    op: z.literal('blur'),
    sigma: z.number().min(BLUR_SIGMA_MIN).max(BLUR_SIGMA_MAX).optional(),
    minAmplitude: z.number().min(0.001).max(1).optional(),
    precision: z.enum(['integer', 'float', 'approximate']).optional(),
  })
  .refine(
    (step) =>
      step.sigma !== undefined ||
      (step.minAmplitude === undefined && step.precision === undefined),
    { error: 'blur needs sigma when minAmplitude or precision is set' },
  )

const convolveSchema = z
  .strictObject({
    op: z.literal('convolve'),
    width: positiveIntSchema,
    height: positiveIntSchema,
    kernel: z.array(z.number()).min(1),
    scale: z.number().optional(),
    offset: z.number().optional(),
  })
  .refine((step) => step.kernel.length === step.width * step.height, {
    error: 'convolve kernel must have width × height values',
    path: ['kernel'],
  })

const normaliseFields = {
  lower: z
    .number()
    .min(0)
    .max(PERCENTILE_MAX - 1)
    .optional(),
  upper: z.number().min(1).max(PERCENTILE_MAX).optional(),
}

export const filterOpSchemas = [
  sharpenSchema,
  z.strictObject({
    op: z.literal('median'),
    size: positiveIntSchema.optional(),
  }),
  blurSchema,
  z.strictObject({
    op: z.literal('dilate'),
    width: positiveIntSchema.optional(),
  }),
  z.strictObject({
    op: z.literal('erode'),
    width: positiveIntSchema.optional(),
  }),
  z.strictObject({
    op: z.literal('flatten'),
    background: colourSchema.optional(),
  }),
  z.strictObject({ op: z.literal('unflatten') }),
  z.strictObject({
    op: z.literal('gamma'),
    gamma: z.number().min(GAMMA_MIN).max(GAMMA_MAX).optional(),
    gammaOut: z.number().min(GAMMA_MIN).max(GAMMA_MAX).optional(),
  }),
  z.strictObject({
    op: z.literal('negate'),
    alpha: z
      .boolean()
      .optional()
      .describe(
        'Also invert the transparency. Off by default, so a see-through picture stays as see-through as it was.',
      ),
  }),
  z.strictObject({ op: z.literal('normalise'), ...normaliseFields }),
  z.strictObject({ op: z.literal('normalize'), ...normaliseFields }),
  z.strictObject({
    op: z.literal('clahe'),
    width: positiveIntSchema,
    height: positiveIntSchema,
    maxSlope: z.number().int().min(0).max(CLAHE_SLOPE_MAX).optional(),
  }),
  convolveSchema,
  z.strictObject({
    op: z.literal('threshold'),
    threshold: z.number().int().min(0).max(THRESHOLD_MAX).optional(),
    greyscale: z.boolean().optional(),
  }),
  z.strictObject({
    op: z.literal('boolean'),
    operand: filePathSchema,
    operator: boolOperatorSchema,
    raw: rawInputSchema
      .pick({ width: true, height: true, channels: true })
      .optional(),
  }),
  z.strictObject({
    op: z.literal('linear'),
    a: z.union([linearValueSchema, z.null()]).optional(),
    b: linearValueSchema.optional(),
  }),
  z.strictObject({ op: z.literal('recomb'), matrix: recombMatrixSchema }),
  z.strictObject({
    op: z.literal('modulate'),
    brightness: z.number().nonnegative().optional(),
    saturation: z.number().nonnegative().optional(),
    hue: z.number().optional(),
    lightness: z.number().optional(),
  }),
] as const

export type FilterOp = z.infer<(typeof filterOpSchemas)[number]>

function applySharpen(
  image: Sharp,
  step: Extract<FilterOp, { op: 'sharpen' }>,
): Sharp {
  const { op: _op, sigma, ...rest } = step
  return sigma === undefined
    ? image.sharpen()
    : image.sharpen({ sigma, ...rest })
}

function applyBlur(
  image: Sharp,
  step: Extract<FilterOp, { op: 'blur' }>,
): Sharp {
  const { op: _op, sigma, ...rest } = step
  return sigma === undefined ? image.blur() : image.blur({ sigma, ...rest })
}

export function applyFilterOp(image: Sharp, step: FilterOp): Sharp {
  switch (step.op) {
    case 'sharpen':
      return applySharpen(image, step)
    case 'median':
      return image.median(step.size)
    case 'blur':
      return applyBlur(image, step)
    case 'dilate':
      return image.dilate(step.width)
    case 'erode':
      return image.erode(step.width)
    case 'flatten':
      return image.flatten({ background: step.background })
    case 'unflatten':
      return image.unflatten()
    case 'gamma':
      return image.gamma(step.gamma, step.gammaOut)
    case 'negate':
      return image.negate({ alpha: step.alpha ?? false })
    case 'normalise':
    case 'normalize':
      return image.normalise({ lower: step.lower, upper: step.upper })
    case 'clahe':
      return image.clahe({
        width: step.width,
        height: step.height,
        maxSlope: step.maxSlope,
      })
    case 'convolve': {
      const { op: _op, ...kernel } = step
      return image.convolve(kernel)
    }
    case 'threshold':
      return image.threshold(step.threshold, { greyscale: step.greyscale })
    case 'boolean':
      return image.boolean(
        step.operand,
        step.operator,
        step.raw && { raw: step.raw },
      )
    case 'linear':
      return image.linear(step.a, step.b)
    case 'recomb':
      return image.recomb(step.matrix)
    case 'modulate': {
      const { op: _op, ...options } = step
      return image.modulate(options)
    }
  }
}
