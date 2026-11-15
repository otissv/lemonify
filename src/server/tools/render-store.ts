import { createReadStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'

export enum RenderKind {
  /** A display-sized render of a Pipeline. */
  Preview = 'preview',
  /** A small render of a Pipeline up to one Step. */
  Thumbnail = 'thumbnail',
}

export const RENDER_MEDIA_TYPE = 'image/webp'

const EXTENSION = '.webp'
const PARTIAL_SUFFIX = '.partial'
const KEY_PATTERN = /^[0-9a-f]{64}$/

export interface RenderTarget {
  /** Where to write the render. */
  partial: string
  final: string
}

/**
 * Renders kept on disk, one per kind and key. It is a cache, not saved
 * work: anything in it can be made again from a Source and its steps, so it
 * may be emptied at any time.
 */
export interface RenderStore {
  /** The stored render for a key, or undefined; finding it counts as using it. */
  find(kind: RenderKind, key: string): Promise<string | undefined>
  /** Where to write a render for a key; pass the result to `commit` when done. */
  reserve(kind: RenderKind, key: string): Promise<RenderTarget>
  /** Puts a written render in place and makes room if the cache is too big. */
  commit(target: RenderTarget): Promise<string>
  /** Throws away a render that could not be finished. */
  discard(target: RenderTarget): Promise<void>
  /** A read stream of a stored render, for serving it. */
  open(kind: RenderKind, key: string): Readable
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

interface Entry {
  file: string
  size: number
  used: number
}

/**
 * A render is written beside its final name and renamed into place, so a
 * half-written one is never found, and the least recently used renders are
 * removed once the folder is over `maxBytes`.
 */
export class FileRenderStore implements RenderStore {
  readonly #directory: string
  readonly #maxBytes: number

  constructor(directory: string, maxBytes: number) {
    this.#directory = directory
    this.#maxBytes = maxBytes
  }

  #fileFor(kind: RenderKind, key: string): string {
    if (!KEY_PATTERN.test(key)) {
      throw new TypeError('A render key is 64 lowercase hexadecimal digits.')
    }
    return path.join(this.#directory, kind, `${key}${EXTENSION}`)
  }

  async find(kind: RenderKind, key: string): Promise<string | undefined> {
    const file = this.#fileFor(kind, key)
    try {
      const now = new Date()
      await utimes(file, now, now)
      return file
    } catch (error) {
      if (isMissing(error)) return undefined
      throw error
    }
  }

  async reserve(kind: RenderKind, key: string): Promise<RenderTarget> {
    const final = this.#fileFor(kind, key)
    await mkdir(path.dirname(final), { recursive: true })
    return { partial: `${final}${PARTIAL_SUFFIX}`, final }
  }

  async commit(target: RenderTarget): Promise<string> {
    await rename(target.partial, target.final)
    await this.#prune(target.final)
    return target.final
  }

  async discard(target: RenderTarget): Promise<void> {
    await rm(target.partial, { force: true })
  }

  open(kind: RenderKind, key: string): Readable {
    return createReadStream(this.#fileFor(kind, key))
  }

  async #prune(keep: string): Promise<void> {
    const entries = await this.#entries()
    let total = 0
    for (const entry of entries) total += entry.size
    entries.sort((a, b) => a.used - b.used)
    for (const entry of entries) {
      if (total <= this.#maxBytes) return
      if (entry.file === keep) continue
      await rm(entry.file, { force: true })
      total -= entry.size
    }
  }

  async #entries(): Promise<Array<Entry>> {
    const entries: Array<Entry> = []
    for (const kind of Object.values(RenderKind)) {
      const folder = path.join(this.#directory, kind)
      let names: Array<string>
      try {
        names = await readdir(folder)
      } catch (error) {
        if (isMissing(error)) continue
        throw error
      }
      for (const name of names) {
        if (name.endsWith(PARTIAL_SUFFIX)) continue
        const file = path.join(folder, name)
        const stats = await stat(file)
        entries.push({ file, size: stats.size, used: stats.mtimeMs })
      }
    }
    return entries
  }
}
