import { z } from 'zod'

import { parseWithSchema } from './validation.ts'
import { filePathSchema } from './sharp/common.ts'
import { sharpOpSchema } from './sharp/ops.ts'
import {
  DEFAULT_UPSCALE_MODEL,
  findModel,
  modelNames,
} from './upscale-models.ts'
import type { PinnedModel } from './upscale-models.ts'

const MIN_TILE_SIZE = 32
const MAX_ITERATIONS = 3
const MAX_CUSTOM_SCALE = 16
const NOISE_LEVELS = [-1, 0, 1, 2, 3] as const

const tileSizeSchema = z
  .number()
  .int()
  .refine((size) => size === 0 || size >= MIN_TILE_SIZE, {
    error: `tileSize must be 0 (auto) or at least ${MIN_TILE_SIZE}`,
  })

export const customModelSchema = z
  .strictObject({
    directory: filePathSchema.describe(
      'Folder holding <name>.param and <name>.bin',
    ),
    name: z.string().trim().min(1),
    scale: z.number().int().min(1).max(MAX_CUSTOM_SCALE),
  })
  .describe('Your own ncnn model instead of a catalogue model')

/** Everything `upscayl-bin` does itself; format, size and metadata are left to the Sharp `ops`. */
export const upscaleOptionsSchema = z
  .strictObject({
    source: filePathSchema,
    destination: filePathSchema,
    recursive: z.boolean().default(false),
    model: z
      .enum(modelNames())
      .optional()
      .describe(`Default ${DEFAULT_UPSCALE_MODEL}`),
    customModel: customModelSchema.optional(),
    scale: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('One of the model’s scales; defaults to its largest'),
    noise: z.literal(NOISE_LEVELS).optional(),
    iterations: z
      .number()
      .int()
      .min(1)
      .max(MAX_ITERATIONS)
      .default(1)
      .describe(
        'Run the model again on its own output (Upscayl’s double upscayl)',
      ),
    tileSize: tileSizeSchema.optional(),
    maxTileSize: z.number().int().min(MIN_TILE_SIZE).optional(),
    memorySafePercentage: z.number().int().min(1).max(100).optional(),
    gpuId: z
      .string()
      .regex(/^(auto|\d+(,\d+)*)$/, {
        error: 'gpuId must be auto, 0, or 0,1,…',
      })
      .optional(),
    threads: z.number().int().positive().optional(),
    tta: z.boolean().default(false),
    fp32: z.boolean().default(false),
    ops: z
      .array(sharpOpSchema)
      .default([])
      .describe(
        'Sharp ops applied to the upscaled image, as for `pnpm images sharp`',
      ),
    dryRun: z
      .boolean()
      .default(false)
      .describe(
        'List every file the upscale would read and write, writing nothing and needing no GPU',
      ),
  })
  .superRefine((options, context) => {
    for (const message of modelProblems(options)) {
      context.addIssue({ code: 'custom', message })
    }
  })
export type UpscaleOptionsInput = z.input<typeof upscaleOptionsSchema>
export type UpscaleOptions = z.output<typeof upscaleOptionsSchema>

type ModelFields = Pick<
  UpscaleOptions,
  'model' | 'customModel' | 'scale' | 'noise'
>

function pinnedProblems(model: PinnedModel, options: ModelFields): string[] {
  const problems: string[] = []
  if (options.scale !== undefined && !model.scales.includes(options.scale)) {
    problems.push(`${model.name} offers scale ${model.scales.join(', ')}`)
  }
  if (options.noise === undefined) return problems
  if (model.noise === null) {
    problems.push(`${model.name} has no noise levels`)
  } else if (!model.noise.includes(options.noise)) {
    problems.push(`${model.name} offers noise ${model.noise.join(', ')}`)
  }
  return problems
}

function modelProblems(options: ModelFields): string[] {
  const { customModel } = options
  if (!customModel) {
    const model = findModel(options.model ?? DEFAULT_UPSCALE_MODEL)
    return model ? pinnedProblems(model, options) : []
  }
  const problems: string[] = []
  if (options.model !== undefined)
    problems.push('Use either model or customModel')
  if (findModel(customModel.name)) {
    problems.push(
      `customModel name "${customModel.name}" clashes with a catalogue model`,
    )
  }
  if (options.scale !== undefined && options.scale !== customModel.scale) {
    problems.push(`The custom model runs at scale ${customModel.scale}`)
  }
  return problems
}

export function parseUpscaleOptions(input: unknown): UpscaleOptions {
  return parseWithSchema(upscaleOptionsSchema, input)
}

export type ModelChoice =
  | { kind: 'pinned'; model: PinnedModel }
  | { kind: 'custom'; directory: string; name: string }

export interface ResolvedModel {
  model: ModelChoice
  scale: number
}

/** The model to run and its scale, with defaults applied. Options must already be validated. */
export function resolveModel(options: UpscaleOptions): ResolvedModel {
  if (options.customModel) {
    const { directory, name, scale } = options.customModel
    return { model: { kind: 'custom', directory, name }, scale }
  }
  const name = options.model ?? DEFAULT_UPSCALE_MODEL
  const model = findModel(name)
  if (!model) throw new TypeError(`Unknown model "${name}" passed validation`)
  return {
    model: { kind: 'pinned', model },
    scale: options.scale ?? Math.max(...model.scales),
  }
}
