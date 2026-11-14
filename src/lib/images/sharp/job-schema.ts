import { z } from 'zod'

import {
  filePathSchema,
  nonNegativeIntSchema,
  positiveIntSchema,
} from './common.ts'
import { sharpInputOptionsSchema } from './input-options.ts'
import { sharpOpSchema } from './ops.ts'
import { OUTPUT_OPTION_SCHEMAS } from './output-options.ts'

/** Process-wide Sharp settings (`sharp.concurrency()`, `sharp.cache()`, …) applied before the job runs. */
export const sharpSettingsSchema = z.strictObject({
  concurrency: nonNegativeIntSchema.optional(),
  cache: z
    .union([
      z.boolean(),
      z.strictObject({
        memory: nonNegativeIntSchema.optional(),
        files: nonNegativeIntSchema.optional(),
        items: nonNegativeIntSchema.optional(),
      }),
    ])
    .optional(),
  simd: z.boolean().optional(),
  block: z.array(z.string().min(1)).min(1).optional(),
  unblock: z.array(z.string().min(1)).min(1).optional(),
})
export type SharpSettings = z.infer<typeof sharpSettingsSchema>

/** Encoder options per output format, used for whichever format each output is written in. */
export const formatOptionsSchema = z
  .strictObject({
    jpeg: OUTPUT_OPTION_SCHEMAS.jpeg,
    png: OUTPUT_OPTION_SCHEMAS.png,
    webp: OUTPUT_OPTION_SCHEMAS.webp,
    gif: OUTPUT_OPTION_SCHEMAS.gif,
    avif: OUTPUT_OPTION_SCHEMAS.avif,
    heif: OUTPUT_OPTION_SCHEMAS.heif,
    tiff: OUTPUT_OPTION_SCHEMAS.tiff,
    jxl: OUTPUT_OPTION_SCHEMAS.jxl,
    jp2: OUTPUT_OPTION_SCHEMAS.jp2,
    raw: OUTPUT_OPTION_SCHEMAS.raw,
  })
  .partial()
export type FormatOptions = z.infer<typeof formatOptionsSchema>

/** One output per width, named `<name>-<width><ext>`, resized after every pixel op. */
export const variantsSchema = z.strictObject({
  widths: z.array(positiveIntSchema).min(1),
  manifest: filePathSchema
    .optional()
    .describe('JSON file mapping each source to its size and variants'),
})

export const IN_PLACE_MODES = ['always', 'ifSmaller'] as const

const sharpJobShape = z.strictObject({
  input: z.union([filePathSchema, z.array(filePathSchema).min(2)]).optional(),
  output: filePathSchema.optional(),
  inPlace: z
    .enum(IN_PLACE_MODES)
    .optional()
    .describe(
      'Overwrite each source; ifSmaller keeps it when the result is not smaller',
    ),
  variants: variantsSchema.optional(),
  options: sharpInputOptionsSchema.optional(),
  ops: z.array(sharpOpSchema).default([]),
  formatOptions: formatOptionsSchema.optional(),
  settings: sharpSettingsSchema.optional(),
  recursive: z
    .boolean()
    .default(false)
    .describe('When input is a folder, include subfolders'),
})
type SharpJobShape = z.output<typeof sharpJobShape>

function inputProblems(job: SharpJobShape): string[] {
  const generated = job.options?.create ?? job.options?.text
  const several = Array.isArray(job.input)
  const problems: string[] = []
  if (job.input === undefined && !generated)
    problems.push('Provide input, or options.create / options.text')
  if (job.input !== undefined && generated)
    problems.push(
      'input cannot be combined with options.create or options.text',
    )
  if (several && !job.options?.join)
    problems.push('Several inputs need options.join')
  if (!several && job.options?.join)
    problems.push('options.join needs several inputs')
  return problems
}

function outputProblems(job: SharpJobShape): string[] {
  const singlePath = typeof job.input === 'string'
  const tiles = job.ops.some((step) => step.op === 'tile')
  const problems: string[] = []
  if (job.output === undefined && !job.inPlace)
    problems.push('Provide output, or set inPlace')
  if (job.output !== undefined && job.inPlace)
    problems.push('inPlace cannot be combined with output')
  if (job.inPlace && !singlePath)
    problems.push('inPlace needs a file or folder input')
  if (job.inPlace && job.variants)
    problems.push('inPlace cannot be combined with variants')
  if (job.variants && !singlePath)
    problems.push('variants need a file or folder input')
  if (tiles && (job.inPlace !== undefined || job.variants !== undefined))
    problems.push('The tile op cannot be combined with inPlace or variants')
  return problems
}

/**
 * A Sharp pipeline: read `input` (a file, a folder, several files to
 * `join`, or nothing when `options.create`/`options.text` generates the
 * image), apply `ops`, and write to `output`, to one file per width with
 * `variants`, or back over each source with `inPlace`.
 */
export const sharpJobSchema = sharpJobShape.superRefine((job, context) => {
  for (const message of [...inputProblems(job), ...outputProblems(job)])
    context.addIssue({ code: 'custom', message })
})
export type SharpJobInput = z.input<typeof sharpJobSchema>
export type SharpJob = z.output<typeof sharpJobSchema>
