import { readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

/**
 * The upscale model catalogue. Every model `upscayl-bin` can run is listed
 * in `upscale-models.json` with the SHA-256 of each file, so a download is
 * only accepted when it matches exactly. `scripts/images/pin-models.ts`
 * regenerates that file from the pinned sources below.
 */

/** Model kinds `pnpm images upscale` runs: AI upscaling, and 1× restoration. */
export const MODEL_CATEGORIES = [
  'upscale',
  'descreen',
  'artifact-removal',
] as const
export type ModelCategory = (typeof MODEL_CATEGORIES)[number]

export const MODEL_SOURCES = ['opencomic', 'upscayl'] as const

/** opencomic-ai-models at the commit `opencomic-ai-bin` 1.6.1 downloads from. */
export const OPENCOMIC_MODELS_URL =
  'https://raw.githubusercontent.com/ollm/opencomic-ai-models/ca1c17faabcb029a14b8bcabfc864227d6b9e2b2/models/'

/** Upscayl's own models (AGPL-3.0 repository) at a fixed commit. */
export const UPSCAYL_MODELS_URL =
  'https://raw.githubusercontent.com/upscayl/upscayl/e1aeaf1217b6061b4212b87c9fd421984f73e437/resources/models/'

/**
 * The project's folder for downloaded model files, anchored to this file
 * so the CLI uses one copy whichever folder it is started from.
 */
export const MODELS_ROOT = path.resolve(
  import.meta.dirname,
  '../../..',
  '.tools/upscayl-models',
)

export const DEFAULT_UPSCALE_MODEL = '4x_NMKD-Siax_200k'

const MANIFEST_FILE = new URL('./upscale-models.json', import.meta.url)

export const pinnedFileSchema = z.strictObject({
  name: z.string().min(1),
  url: z.url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
})
export type PinnedFile = z.infer<typeof pinnedFileSchema>

export const pinnedModelSchema = z.strictObject({
  name: z.string().min(1),
  source: z.enum(MODEL_SOURCES),
  category: z.enum(MODEL_CATEGORIES),
  description: z.string(),
  /** Folder below `MODELS_ROOT` holding the files. */
  directory: z.string().min(1),
  scales: z.array(z.number().int().positive()).min(1),
  /** Denoise levels the model offers, or null when it has none. */
  noise: z.array(z.number().int()).nullable(),
  files: z.array(pinnedFileSchema).min(2),
})
export type PinnedModel = z.infer<typeof pinnedModelSchema>

export const modelManifestSchema = z.strictObject({
  models: z.array(pinnedModelSchema).min(1),
})
export type ModelManifest = z.infer<typeof modelManifestSchema>

let manifest: ModelManifest | undefined

/** The pinned catalogue, read and validated once. */
export function modelManifest(): ModelManifest {
  manifest ??= modelManifestSchema.parse(
    JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')),
  )
  return manifest
}

export function modelNames(): [string, ...string[]] {
  const [first, ...rest] = modelManifest().models
  const names: [string, ...string[]] = [first.name]
  for (const model of rest) names.push(model.name)
  return names
}

export function findModel(name: string): PinnedModel | undefined {
  return modelManifest().models.find((model) => model.name === name)
}

/** Folder that holds a model's files under `modelsRoot`. */
export function modelDirectory(modelsRoot: string, model: PinnedModel): string {
  return path.join(modelsRoot, model.directory)
}
