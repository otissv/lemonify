import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'

import {
  imageManifestSchema,
  writeManifest,
} from '../../src/lib/images/manifest.ts'
import type { ImageManifest } from '../../src/lib/images/manifest.ts'
import type { App } from '../../src/server/composition.ts'
import type { Actor } from '../../src/server/domain/actor.ts'
import type { RunOutput } from '../../src/server/services/workflow-service.ts'
import { saveResult } from './save-result.ts'

export const MANIFEST_FILE_NAME = 'manifest.json'

/** What to do when a file with the same name is already in the folder. */
export type ExistingFiles = 'skip' | 'overwrite' | 'number'

export const EXISTING_FILES: ReadonlyArray<ExistingFiles> = [
  'skip',
  'overwrite',
  'number',
]

export type WriteOptions = {
  existing: ExistingFiles
  manifest: boolean
}

export type WrittenOutputs = {
  folder: string
  written: string[]
  skipped: string[]
  manifest?: string
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function numbered(folder: string, fileName: string): Promise<string> {
  const { name, ext } = path.parse(fileName)
  for (let count = 1; ; count += 1) {
    const candidate = `${name}-${count}${ext}`
    if (!(await exists(path.join(folder, candidate)))) return candidate
  }
}

/** The name an image is written under, or undefined when it is to be skipped. */
async function chooseName(
  folder: string,
  fileName: string,
  existing: ExistingFiles,
): Promise<string | undefined> {
  if (!(await exists(path.join(folder, fileName)))) return fileName
  if (existing === 'skip') return undefined
  if (existing === 'overwrite') return fileName
  return numbered(folder, fileName)
}

/**
 * Copies what a workflow run made into a folder, one file per image, named
 * as the Output settings named them. With `manifest`, also writes
 * `manifest.json`: for each source image its size and the files made from it,
 * the same shape as the stateless `sharp` command's manifest.
 */
export async function writeRunOutputs(
  app: App,
  actor: Actor,
  outputs: ReadonlyArray<RunOutput>,
  folder: string,
  options: WriteOptions,
): Promise<WrittenOutputs> {
  const destination = path.resolve(folder)
  await mkdir(destination, { recursive: true })
  const written: string[] = []
  const skipped: string[] = []
  const manifest: ImageManifest = {}
  for (const output of outputs) {
    const variants: Array<{ path: string; width: number }> = []
    for (const image of output.images) {
      const name = await chooseName(
        destination,
        image.fileName,
        options.existing,
      )
      if (name === undefined) {
        skipped.push(path.join(destination, image.fileName))
        continue
      }
      const saved = await saveResult(
        app,
        actor,
        image.resultId,
        path.join(destination, name),
      )
      written.push(saved.path)
      variants.push({ path: name, width: image.width ?? output.source.width })
    }
    manifest[output.source.fileName] = {
      width: output.source.width,
      height: output.source.height,
      variants,
    }
  }
  if (!options.manifest) return { folder: destination, written, skipped }
  const file = path.join(destination, MANIFEST_FILE_NAME)
  await writeManifest(file, imageManifestSchema.parse(manifest))
  return { folder: destination, written, skipped, manifest: file }
}
