import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ModelChecksumError, ModelDownloadError } from './errors.ts'
import {
  MODEL_SOURCE_URL,
  UPSCALE_MODELS,
  modelFilesDirectory,
} from './upscale-models.ts'
import type { ModelFile, UpscaleModelName } from './upscale-models.ts'

export type Fetcher = (url: string) => Promise<Response>

export interface InstallModelFilesOptions {
  directory: string
  baseUrl: string
  files: readonly ModelFile[]
  fetch?: Fetcher
}

export interface InstalledModelFile {
  file: string
  downloaded: boolean
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

async function readIfPresent(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

async function download(url: string, fetcher: Fetcher): Promise<Uint8Array> {
  let response: Response
  try {
    response = await fetcher(url)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new ModelDownloadError(url, `the request failed (${reason})`, {
      cause: error,
    })
  }
  if (!response.ok) {
    throw new ModelDownloadError(url, `the server answered ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

/** Writes through a temporary file so an interrupted run never leaves a partial model behind. */
async function writeAtomically(file: string, data: Uint8Array): Promise<void> {
  const temporary = `${file}.part`
  try {
    await writeFile(temporary, data)
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true })
  }
}

async function installFile(
  file: ModelFile,
  options: InstallModelFilesOptions,
  fetcher: Fetcher,
): Promise<InstalledModelFile> {
  const target = path.join(options.directory, file.name)
  const existing = await readIfPresent(target)
  if (existing && sha256(existing) === file.sha256) {
    return { file: target, downloaded: false }
  }
  const url = new URL(file.name, options.baseUrl).href
  const data = await download(url, fetcher)
  const actual = sha256(data)
  if (actual !== file.sha256) {
    throw new ModelChecksumError(url, file.sha256, actual)
  }
  await writeAtomically(target, data)
  return { file: target, downloaded: true }
}

/** Ensures each file exists in `directory` with its pinned checksum, downloading only what is missing or wrong. */
export async function installModelFiles(
  options: InstallModelFilesOptions,
): Promise<InstalledModelFile[]> {
  const fetcher = options.fetch ?? fetch
  await mkdir(options.directory, { recursive: true })
  const results: InstalledModelFile[] = []
  for (const file of options.files) {
    results.push(await installFile(file, options, fetcher))
  }
  return results
}

/** Installs the named upscale models under `modelsRoot` in the layout `opencomic-ai-bin` expects. */
export async function installUpscaleModels(
  modelsRoot: string,
  names: readonly UpscaleModelName[],
): Promise<InstalledModelFile[]> {
  const files: ModelFile[] = []
  for (const name of names) files.push(...UPSCALE_MODELS[name].files)
  return installModelFiles({
    directory: modelFilesDirectory(modelsRoot),
    baseUrl: MODEL_SOURCE_URL,
    files,
  })
}
