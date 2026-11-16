import { once } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'

import { LimitError } from '../errors.ts'

const HASH_PATTERN = /^[0-9a-f]{64}$/
const INCOMING_DIRECTORY = '.incoming'
const BYTES_PER_MEGABYTE = 1024 * 1024

export type StagedUpload = {
  contentHash: string
  bytes: number
  /** Where the bytes are until they are committed; engines may read it. */
  path: string
  /** Keeps the upload under its content hash; an existing file is kept as it is. */
  commit(): Promise<void>
  /** Throws the upload away. */
  discard(): Promise<void>
}

/** Where uploaded Sources live as files, named by their content hash. */
export interface SourceStore {
  stage(
    body: AsyncIterable<Uint8Array>,
    maxBytes: number,
  ): Promise<StagedUpload>
  pathOf(contentHash: string): string
  open(contentHash: string): Readable
  remove(contentHash: string): Promise<void>
  /** Every stored file with when it was last written, for the sweep of orphans. */
  list(): Promise<Array<{ contentHash: string; modifiedMs: number }>>
  /** Removes uploads that were started and never finished, older than the age. */
  removeStaleUploads(olderThanMs: number, nowMs: number): Promise<void>
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

function tooLarge(maxBytes: number): LimitError {
  const megabytes = Math.max(1, Math.floor(maxBytes / BYTES_PER_MEGABYTE))
  return new LimitError(`The image is larger than the ${megabytes} MB limit.`)
}

export class FileSourceStore implements SourceStore {
  readonly #root: string

  constructor(root: string) {
    this.#root = root
  }

  pathOf(contentHash: string): string {
    if (!HASH_PATTERN.test(contentHash)) {
      throw new TypeError('A content hash is 64 lowercase hexadecimal digits.')
    }
    return path.join(this.#root, contentHash)
  }

  open(contentHash: string): Readable {
    return createReadStream(this.pathOf(contentHash))
  }

  async remove(contentHash: string): Promise<void> {
    await rm(this.pathOf(contentHash), { force: true })
  }

  async list(): Promise<Array<{ contentHash: string; modifiedMs: number }>> {
    let names: string[]
    try {
      names = await readdir(this.#root)
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    const files: Array<{ contentHash: string; modifiedMs: number }> = []
    for (const name of names) {
      if (!HASH_PATTERN.test(name)) continue
      const stats = await stat(path.join(this.#root, name))
      files.push({ contentHash: name, modifiedMs: stats.mtimeMs })
    }
    return files
  }

  async removeStaleUploads(olderThanMs: number, nowMs: number): Promise<void> {
    const incoming = path.join(this.#root, INCOMING_DIRECTORY)
    let names: string[]
    try {
      names = await readdir(incoming)
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }
    for (const name of names) {
      const file = path.join(incoming, name)
      const stats = await stat(file)
      if (nowMs - stats.mtimeMs > olderThanMs) await rm(file, { force: true })
    }
  }

  async stage(
    body: AsyncIterable<Uint8Array>,
    maxBytes: number,
  ): Promise<StagedUpload> {
    const incoming = path.join(this.#root, INCOMING_DIRECTORY)
    await mkdir(incoming, { recursive: true })
    const partial = path.join(incoming, `${randomUUID()}.partial`)
    const { contentHash, bytes } = await this.#write(body, partial, maxBytes)
    const final = this.pathOf(contentHash)
    return {
      contentHash,
      bytes,
      path: partial,
      commit: async () => {
        if (await exists(final)) {
          await rm(partial, { force: true })
          return
        }
        await rename(partial, final)
      },
      discard: () => rm(partial, { force: true }),
    }
  }

  async #write(
    body: AsyncIterable<Uint8Array>,
    partial: string,
    maxBytes: number,
  ): Promise<{ contentHash: string; bytes: number }> {
    const hash = createHash('sha256')
    const out = createWriteStream(partial, { flags: 'wx', mode: 0o600 })
    let bytes = 0
    try {
      for await (const chunk of body) {
        bytes += chunk.byteLength
        if (bytes > maxBytes) throw tooLarge(maxBytes)
        hash.update(chunk)
        if (!out.write(chunk)) await once(out, 'drain')
      }
      await finish(out)
    } catch (error) {
      out.destroy()
      await rm(partial, { force: true })
      throw error
    }
    return { contentHash: hash.digest('hex'), bytes }
  }
}

function finish(stream: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.once('error', reject)
    stream.end(() => resolve())
  })
}
