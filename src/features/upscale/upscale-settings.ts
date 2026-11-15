import { z } from 'zod'

import type { PinnedModel } from '@/lib/images/upscale-models'

/** What the browser needs to know about a model; download details stay on the server. */
export type UpscaleModelSummary = Pick<
  PinnedModel,
  'name' | 'category' | 'description' | 'scales' | 'noise'
>

export interface UpscaleCatalogue {
  defaultModel: string
  models: ReadonlyArray<UpscaleModelSummary>
}

export const MIN_UPSCALE_PASSES = 1
export const MAX_UPSCALE_PASSES = 3

/**
 * The upscale options chosen in the panel or a workflow step. The full
 * option set, with model-specific checks, is validated by
 * `upscaleOptionsSchema` on the server when an upscale runs.
 */
export const UpscaleSettingsSchema = z.object({
  model: z.string().min(1),
  scale: z.number().int().positive(),
  noise: z.number().int().optional(),
  iterations: z.number().int().min(MIN_UPSCALE_PASSES).max(MAX_UPSCALE_PASSES),
  tta: z.boolean(),
})

export type UpscaleSettings = z.infer<typeof UpscaleSettingsSchema>

const NO_DENOISE = 0

function findSummary(
  catalogue: UpscaleCatalogue,
  name: string,
): UpscaleModelSummary {
  const model = catalogue.models.find((candidate) => candidate.name === name)
  if (!model) throw new RangeError(`Unknown upscale model "${name}"`)
  return model
}

function startingNoise(model: UpscaleModelSummary): UpscaleSettings['noise'] {
  if (!model.noise) return undefined
  const level = model.noise.includes(NO_DENOISE) ? NO_DENOISE : model.noise[0]
  return level
}

/** Settings for a file nobody has changed yet. */
export function defaultUpscaleSettings(
  catalogue: UpscaleCatalogue,
): UpscaleSettings {
  const model = findSummary(catalogue, catalogue.defaultModel)
  return {
    model: model.name,
    scale: Math.max(...model.scales),
    noise: startingNoise(model),
    iterations: MIN_UPSCALE_PASSES,
    tta: false,
  }
}

/** Switches model, keeping the scale and noise level when the new model offers them. */
export function withModel(
  settings: UpscaleSettings,
  catalogue: UpscaleCatalogue,
  name: string,
): UpscaleSettings {
  const model = findSummary(catalogue, name)
  const scale = model.scales.includes(settings.scale)
    ? settings.scale
    : Math.max(...model.scales)
  const keepsNoise =
    settings.noise !== undefined &&
    (model.noise?.includes(settings.noise) ?? false)
  return {
    ...settings,
    model: model.name,
    scale,
    noise: keepsNoise ? settings.noise : startingNoise(model),
  }
}
