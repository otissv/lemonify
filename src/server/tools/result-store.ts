import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  access,
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const KEY_PATTERN = /^[0-9a-f]{64}$/

/** Where Results live as files, named by their key. Nothing here is ever evicted. */
export interface ResultStore {
  /** Moves a finished file in under `key`; if the key is already stored the file is dropped. */
  keep(file: string, key: string): Promise<void>
  /** The sha-256 of a file, which makes a good key for a Result that has no other. */
  contentKey(file: string): Promise<string>
  has(key: string): Promise<boolean>
  open(key: string): Readable
  pathOf(key: string): string
  remove(key: string): Promise<void>
  /** Every stored file with when it was last written, for the sweep of orphans. */
  list(): Promise<Array<{ key: string; modifiedMs: number }>>
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function isCrossDevice(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EXDEV'
}

export class FileResultStore implements ResultStore {
  readonly #root: string

  constructor(root: string) {
    this.#root = root
  }

  pathOf(key: string): string {
    if (!KEY_PATTERN.test(key)) {
      throw new TypeError('A result key is 64 lowercase hexadecimal digits.')
    }
    return path.join(this.#root, key)
  }

  async has(key: string): Promise<boolean> {
    try {
      await access(this.pathOf(key))
      return true
    } catch (error) {
      if (isMissing(error)) return false
      throw error
    }
  }

  open(key: string): Readable {
    return createReadStream(this.pathOf(key))
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true })
  }

  async contentKey(file: string): Promise<string> {
    const hash = createHash('sha256')
    await pipeline(createReadStream(file), hash)
    return hash.digest('hex')
  }

  async keep(file: string, key: string): Promise<void> {
    const final = this.pathOf(key)
    if (await this.has(key)) {
      await rm(file, { force: true })
      return
    }
    await mkdir(this.#root, { recursive: true })
    try {
      await rename(file, final)
    } catch (error) {
      if (!isCrossDevice(error)) throw error
      await copyFile(file, final)
      await rm(file, { force: true })
    }
  }

  async list(): Promise<Array<{ key: string; modifiedMs: number }>> {
    let names: string[]
    try {
      names = await readdir(this.#root)
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    const files: Array<{ key: string; modifiedMs: number }> = []
    for (const name of names) {
      if (!KEY_PATTERN.test(name)) continue
      const stats = await stat(path.join(this.#root, name))
      files.push({ key: name, modifiedMs: stats.mtimeMs })
    }
    return files
  }
}
