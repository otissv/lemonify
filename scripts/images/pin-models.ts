/**
 * Maintainer tool: downloads every upscale model once, records its SHA-256
 * and size, and writes `src/lib/images/upscale-models.json`, which
 * `pnpm images upscale` and `pnpm images models` verify downloads against.
 *
 * Run after upgrading `opencomic-ai-bin` or moving the Upscayl pin:
 *   node --disable-warning=ExperimentalWarning scripts/images/pin-models.ts
 */
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import OpenComicAI from 'opencomic-ai-bin'

import type {
  ModelManifest,
  PinnedModel,
} from '../../src/lib/images/upscale-models.ts'
import {
  MODEL_CATEGORIES,
  OPENCOMIC_MODELS_URL,
  UPSCAYL_MODELS_URL,
} from '../../src/lib/images/upscale-models.ts'

const MANIFEST = path.resolve('src/lib/images/upscale-models.json')
const CONCURRENT_DOWNLOADS = 4
const UPSCAYL_SCALES = [2, 3, 4]

/** Upscayl's own models, in `resources/models` of the pinned upscayl commit. */
const UPSCAYL_MODELS = [
  'upscayl-standard-4x',
  'upscayl-lite-4x',
  'high-fidelity-4x',
  'digital-art-4x',
] as const

interface PendingFile {
  name: string
  url: string
}

interface PendingModel extends Omit<PinnedModel, 'files'> {
  files: PendingFile[]
}

function opencomicModels(): PendingModel[] {
  const models: PendingModel[] = []
  for (const category of MODEL_CATEGORIES) {
    for (const [key, model] of Object.entries(OpenComicAI.models[category])) {
      const folder = model.folder.replace(/^\.\//, '')
      const directory = `${category}/${folder}`
      const files: PendingFile[] = []
      for (const name of model.files) {
        files.push({ name, url: `${OPENCOMIC_MODELS_URL}${directory}/${name}` })
      }
      models.push({
        name: key,
        source: 'opencomic',
        category,
        description: model.name,
        directory,
        scales: model.scales,
        noise: model.noise ?? null,
        files,
      })
    }
  }
  return models
}

function upscaylModels(): PendingModel[] {
  const models: PendingModel[] = []
  for (const name of UPSCAYL_MODELS) {
    const files: PendingFile[] = []
    for (const file of [`${name}.param`, `${name}.bin`]) {
      files.push({ name: file, url: `${UPSCAYL_MODELS_URL}${file}` })
    }
    models.push({
      name,
      source: 'upscayl',
      category: 'upscale',
      description: `Upscayl ${name}`,
      directory: 'upscayl/models',
      scales: UPSCAYL_SCALES,
      noise: null,
      files,
    })
  }
  return models
}

async function hashFile(
  file: PendingFile,
): Promise<PinnedModel['files'][number]> {
  const response = await fetch(file.url)
  if (!response.ok) throw new Error(`${file.url}: HTTP ${response.status}`)
  const data = new Uint8Array(await response.arrayBuffer())
  const sha256 = createHash('sha256').update(data).digest('hex')
  console.error(`${sha256.slice(0, 12)} ${data.byteLength} ${file.url}`)
  return { name: file.name, url: file.url, sha256, bytes: data.byteLength }
}

async function pinModel(model: PendingModel): Promise<PinnedModel> {
  const files: PinnedModel['files'] = []
  for (const file of model.files) files.push(await hashFile(file))
  return { ...model, files }
}

async function pinAll(models: readonly PendingModel[]): Promise<PinnedModel[]> {
  const pinned: PinnedModel[] = new Array<PinnedModel>(models.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < models.length) {
      const index = next++
      pinned[index] = await pinModel(models[index])
    }
  }
  const workers: Promise<void>[] = []
  for (let i = 0; i < CONCURRENT_DOWNLOADS; i++) workers.push(worker())
  await Promise.all(workers)
  return pinned
}

const manifest: ModelManifest = {
  models: await pinAll([...opencomicModels(), ...upscaylModels()]),
}
await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
console.error(`Pinned ${manifest.models.length} models into ${MANIFEST}`)
