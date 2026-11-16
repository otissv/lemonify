import type { OverlayOptions, Sharp } from 'sharp'
import { z } from 'zod'

import {
  boolOperatorSchema,
  colourSchema,
  colourspaceSchema,
  filePathSchema,
  unitIntervalSchema,
} from './common.ts'
import { SharpOperationError } from './errors.ts'
import { overlaySchema, sharpInputOptionsSchema } from './input-options.ts'

const toggle = z
  .boolean()
  .optional()
  .describe('Defaults to true; false disables the operation')

export const colourOpSchemas = [
  z.strictObject({
    op: z.literal('tint'),
    colour: colourSchema.describe(
      'The tint colour: a CSS string such as "#ff000080", or { r, g, b, alpha }. An alpha below 1 blends the tint with the original image by that strength.',
    ),
  }),
  z.strictObject({
    op: z.literal('opacity'),
    percent: z
      .number()
      .min(0)
      .max(100)
      .describe(
        'How much of the picture shows, as a percentage. Multiplies its own transparency, so what is already see-through stays see-through.',
      ),
  }),
  z.strictObject({ op: z.literal('greyscale'), enabled: toggle }),
  z.strictObject({ op: z.literal('grayscale'), enabled: toggle }),
  z.strictObject({
    op: z.literal('pipelineColourspace'),
    colourspace: colourspaceSchema,
  }),
  z.strictObject({
    op: z.literal('pipelineColorspace'),
    colourspace: colourspaceSchema,
  }),
  z.strictObject({
    op: z.literal('toColourspace'),
    colourspace: colourspaceSchema,
  }),
  z.strictObject({
    op: z.literal('toColorspace'),
    colourspace: colourspaceSchema,
  }),
  z.strictObject({ op: z.literal('removeAlpha') }),
  z.strictObject({
    op: z.literal('ensureAlpha'),
    alpha: unitIntervalSchema.optional(),
  }),
  z.strictObject({
    op: z.literal('extractChannel'),
    channel: z.union([
      z.literal([0, 1, 2, 3]),
      z.enum(['red', 'green', 'blue', 'alpha']),
    ]),
  }),
  z.strictObject({
    op: z.literal('joinChannel'),
    images: z.union([filePathSchema, z.array(filePathSchema).min(1)]),
    options: sharpInputOptionsSchema.optional(),
  }),
  z.strictObject({ op: z.literal('bandbool'), operator: boolOperatorSchema }),
  z.strictObject({
    op: z.literal('composite'),
    images: z.array(overlaySchema).min(1),
  }),
] as const

export type ColourOp = z.infer<(typeof colourOpSchemas)[number]>

export function applyColourOp(image: Sharp, step: ColourOp): Sharp {
  switch (step.op) {
    case 'tint':
      return image.tint(step.colour)
    case 'opacity':
      throw new SharpOperationError(
        'opacity',
        'it needs the pixels of the picture at this step; apply it with applySharpOpsBlended',
      )
    case 'greyscale':
    case 'grayscale':
      return image.greyscale(step.enabled)
    case 'pipelineColourspace':
    case 'pipelineColorspace':
      return image.pipelineColourspace(step.colourspace)
    case 'toColourspace':
    case 'toColorspace':
      return image.toColourspace(step.colourspace)
    case 'removeAlpha':
      return image.removeAlpha()
    case 'ensureAlpha':
      return image.ensureAlpha(step.alpha)
    case 'extractChannel':
      return image.extractChannel(step.channel)
    case 'joinChannel':
      return image.joinChannel(step.images, step.options)
    case 'bandbool':
      return image.bandbool(step.operator)
    case 'composite': {
      const layers: OverlayOptions[] = step.images
      return image.composite(layers)
    }
  }
}
