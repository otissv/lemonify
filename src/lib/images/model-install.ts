import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ModelChecksumError, ModelDownloadError } from './errors.ts'
import { modelDirectory } from './upscale-models.ts'
import type { PinnedFile, PinnedModel } from './upscale-models.ts'

export type Fetcher = (url: string) => Promise<Response>

export interface InstallModelFilesOptions {
  directory: string
  files: readonly PinnedFile[]
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
  file: PinnedFile,
  options: InstallModelFilesOptions,
  fetcher: Fetcher,
): Promise<InstalledModelFile> {
  const target = path.join(options.directory, file.name)
  const existing = await readIfPresent(target)
  if (existing && sha256(existing) === file.sha256) {
    return { file: target, downloaded: false }
  }
  const { url } = file
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

/** Ensures every file of each model is present under `modelsRoot` with its pinned checksum. */
export async function installModels(
  modelsRoot: string,
  models: readonly PinnedModel[],
): Promise<InstalledModelFile[]> {
  const results: InstalledModelFile[] = []
  for (const model of models) {
    const installed = await installModelFiles({
      directory: modelDirectory(modelsRoot, model),
      files: model.files,
    })
    results.push(...installed)
  }
  return results
}

export type ModelInstallState = 'installed' | 'partial' | 'missing'

async function sizeOf(file: string): Promise<number | undefined> {
  try {
    return (await stat(file)).size
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

/** A quick check by file presence and size; checksums are verified when a model is installed or used. */
export async function modelInstallState(
  modelsRoot: string,
  model: PinnedModel,
): Promise<ModelInstallState> {
  const directory = modelDirectory(modelsRoot, model)
  let present = 0
  for (const file of model.files) {
    if ((await sizeOf(path.join(directory, file.name))) === file.bytes)
      present++
  }
  if (present === model.files.length) return 'installed'
  return present === 0 ? 'missing' : 'partial'
}
