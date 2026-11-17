import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type { App } from '../../src/server/composition.ts'
import type { Actor } from '../../src/server/domain/actor.ts'

export type SavedFile = {
  path: string
  bytes: number
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Writes `content` to `destination`, which may be a folder (`fileName` is used)
 * or a file path. The bytes go to a temporary name beside the destination and
 * are renamed into place, so a failed copy never leaves half a file.
 */
export async function writeAtomically(
  destination: string,
  fileName: string,
  content: Readable,
): Promise<string> {
  const target = (await isDirectory(destination))
    ? path.join(destination, fileName)
    : path.resolve(destination)
  await mkdir(path.dirname(target), { recursive: true })
  const partial = path.join(
    path.dirname(target),
    `.${randomUUID()}.partial-${path.basename(target)}`,
  )
  try {
    await pipeline(content, createWriteStream(partial))
    await rename(partial, target)
  } catch (error) {
    await rm(partial, { force: true })
    throw error
  }
  return target
}

/** Writes a Result's image to disk; see `writeAtomically`. */
export async function saveResult(
  app: App,
  actor: Actor,
  resultId: string,
  destination: string,
): Promise<SavedFile> {
  const opened = await app.results.open(actor, resultId)
  const target = await writeAtomically(
    destination,
    opened.fileName,
    opened.stream,
  )
  return { path: target, bytes: opened.bytes }
}
