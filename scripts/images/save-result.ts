import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import type { App } from '../../src/server/composition.ts'
import type { Actor } from '../../src/server/domain/actor.ts'
import { randomUUID } from 'node:crypto'

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
 * Writes a Result's image to disk. The bytes go to a temporary name beside the
 * destination and are renamed into place, so a failed copy never leaves half a
 * file. `destination` may be a folder (the Result's own file name is used) or a
 * file path.
 */
export async function saveResult(
  app: App,
  actor: Actor,
  resultId: string,
  destination: string,
): Promise<SavedFile> {
  const opened = await app.results.open(actor, resultId)
  const target = (await isDirectory(destination))
    ? path.join(destination, opened.fileName)
    : path.resolve(destination)
  await mkdir(path.dirname(target), { recursive: true })
  const partial = path.join(
    path.dirname(target),
    `.${randomUUID()}.partial-${path.basename(target)}`,
  )
  try {
    await pipeline(opened.stream, createWriteStream(partial))
    await rename(partial, target)
  } catch (error) {
    await rm(partial, { force: true })
    throw error
  }
  return { path: target, bytes: opened.bytes }
}
