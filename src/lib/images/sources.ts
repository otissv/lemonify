import type { Stats } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import { ImageSourceError } from './errors.ts'

export interface SourceOptions {
  recursive: boolean
  /** A folder to skip while walking, such as a destination inside the source. */
  exclude?: string
  /** Lower-case file extensions to accept, such as `.jpg`. */
  extensions: readonly string[]
}

function isSupported(file: string, options: SourceOptions): boolean {
  return options.extensions.includes(path.extname(file).toLowerCase())
}

function describeExtensions(options: SourceOptions): string {
  return options.extensions.join(', ')
}

export interface ImageSources {
  /** Folder that output paths are made relative to. */
  root: string
  /** Absolute paths of the images to process, sorted. */
  files: string[]
}

async function statOrUndefined(file: string): Promise<Stats | undefined> {
  try {
    return await stat(file)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw new ImageSourceError(file, 'it could not be read', { cause: error })
  }
}

async function walk(
  directory: string,
  options: SourceOptions,
  files: string[],
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isFile() && isSupported(entry.name, options))
      files.push(entryPath)
    if (!entry.isDirectory() || !options.recursive) continue
    if (options.exclude !== undefined && entryPath === options.exclude) continue
    await walk(entryPath, options, files)
  }
}

/** Resolves a file or folder into the images to process. `source` must be absolute. */
export async function collectSources(
  source: string,
  options: SourceOptions,
): Promise<ImageSources> {
  const info = await statOrUndefined(source)
  if (!info) throw new ImageSourceError(source, 'it does not exist')
  if (info.isFile()) {
    if (!isSupported(source, options)) {
      throw new ImageSourceError(
        source,
        `it is not a supported image (${describeExtensions(options)})`,
      )
    }
    return { root: path.dirname(source), files: [source] }
  }
  if (!info.isDirectory()) {
    throw new ImageSourceError(source, 'it is neither a file nor a folder')
  }
  const files: string[] = []
  await walk(source, options, files)
  if (files.length === 0) {
    throw new ImageSourceError(
      source,
      `the folder contains no supported images (${describeExtensions(options)})`,
    )
  }
  return { root: source, files: files.sort() }
}
