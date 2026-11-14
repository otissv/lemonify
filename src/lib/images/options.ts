import { z } from 'zod'

import { ImageOptionsError } from './errors.ts'

export const IMAGE_FORMATS = ['webp', 'avif', 'jpeg', 'png'] as const
export const DEFAULT_WIDTHS: readonly number[] = [480, 768, 1280, 1920]
export const DEFAULT_FORMAT = 'webp' satisfies ImageFormat
export const DEFAULT_QUALITY = 78
export const DEFAULT_MAX_WIDTH = 1920

const MIN_QUALITY = 1
const MAX_QUALITY = 100
const QUALITY_MESSAGE = `Quality must be an integer from ${MIN_QUALITY} to ${MAX_QUALITY}`
const WIDTH_MESSAGE = 'Widths must be positive integers'

export const imageFormatSchema = z.enum(IMAGE_FORMATS, {
  error: `Format must be one of ${IMAGE_FORMATS.join(', ')}`,
})
export type ImageFormat = z.infer<typeof imageFormatSchema>

const qualitySchema = z
  .number({ error: QUALITY_MESSAGE })
  .int({ error: QUALITY_MESSAGE })
  .min(MIN_QUALITY, { error: QUALITY_MESSAGE })
  .max(MAX_QUALITY, { error: QUALITY_MESSAGE })

function positiveIntegerSchema(message: string): z.ZodNumber {
  return z
    .number({ error: message })
    .int({ error: message })
    .positive({ error: message })
}

const pathSchema = z
  .string({ error: 'A path is required' })
  .trim()
  .min(1, { error: 'A path is required' })

function sortUnique(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

const baseOptionsSchema = z.object({
  source: pathSchema,
  recursive: z.boolean().default(false),
})

export const buildOptionsSchema = baseOptionsSchema.extend({
  destination: pathSchema,
  widths: z
    .array(positiveIntegerSchema(WIDTH_MESSAGE))
    .min(1, { error: 'At least one width is required' })
    .transform(sortUnique)
    .default(() => [...DEFAULT_WIDTHS]),
  format: imageFormatSchema.default(DEFAULT_FORMAT),
  quality: qualitySchema.default(DEFAULT_QUALITY),
  manifest: pathSchema.optional(),
})
export type BuildOptionsInput = z.input<typeof buildOptionsSchema>
export type BuildOptions = z.output<typeof buildOptionsSchema>

export const compressOptionsSchema = baseOptionsSchema.extend({
  destination: pathSchema.optional(),
  maxWidth: positiveIntegerSchema(
    'Max width must be a positive integer',
  ).default(DEFAULT_MAX_WIDTH),
  quality: qualitySchema.optional(),
})
export type CompressOptionsInput = z.input<typeof compressOptionsSchema>
export type CompressOptions = z.output<typeof compressOptionsSchema>

export function parseWithSchema<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const issues: string[] = []
  for (const issue of result.error.issues) {
    const field = issue.path.map(String).join('.')
    issues.push(field ? `${field}: ${issue.message}` : issue.message)
  }
  throw new ImageOptionsError(issues)
}

export function parseBuildOptions(input: unknown): BuildOptions {
  return parseWithSchema(buildOptionsSchema, input)
}

export function parseCompressOptions(input: unknown): CompressOptions {
  return parseWithSchema(compressOptionsSchema, input)
}
