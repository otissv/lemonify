import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LimitError } from '../errors'
import { FileSourceStore } from './source-store'

const SHA_OF_HELLO =
  '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

let root = ''
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'lemonify-sources-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

async function* chunks(...parts: string[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield new TextEncoder().encode(part)
}

function incoming(): string[] {
  const dir = path.join(root, '.incoming')
  return existsSync(dir) ? readdirSync(dir) : []
}

describe('FileSourceStore', () => {
  it('hashes and counts the bytes while staging, across chunks', async () => {
    const store = new FileSourceStore(root)
    const staged = await store.stage(chunks('hel', 'lo'), 1000)
    expect(staged.contentHash).toBe(SHA_OF_HELLO)
    expect(staged.bytes).toBe(5)
    expect(readFileSync(staged.path, 'utf8')).toBe('hello')
    await staged.discard()
  })

  it('keeps an upload under its hash when committed, and nothing is left staged', async () => {
    const store = new FileSourceStore(root)
    const staged = await store.stage(chunks('hello'), 1000)
    await staged.commit()
    expect(readFileSync(store.pathOf(SHA_OF_HELLO), 'utf8')).toBe('hello')
    expect(incoming()).toEqual([])
    const read: Buffer[] = []
    for await (const piece of store.open(SHA_OF_HELLO))
      read.push(piece as Buffer)
    expect(Buffer.concat(read).toString()).toBe('hello')
  })

  it('stores the same bytes once', async () => {
    const store = new FileSourceStore(root)
    await (await store.stage(chunks('hello'), 1000)).commit()
    await (await store.stage(chunks('hello'), 1000)).commit()
    expect(readdirSync(root).filter((name) => name !== '.incoming')).toEqual([
      SHA_OF_HELLO,
    ])
    expect(incoming()).toEqual([])
  })

  it('throws a discarded upload away', async () => {
    const store = new FileSourceStore(root)
    const staged = await store.stage(chunks('hello'), 1000)
    await staged.discard()
    expect(incoming()).toEqual([])
    expect(existsSync(store.pathOf(SHA_OF_HELLO))).toBe(false)
  })

  it('refuses an upload over the limit and leaves no partial file', async () => {
    const store = new FileSourceStore(root)
    await expect(store.stage(chunks('12345', '67890'), 8)).rejects.toThrow(
      LimitError,
    )
    expect(incoming()).toEqual([])
  })

  it('removes a stored file, and removing a missing one is fine', async () => {
    const store = new FileSourceStore(root)
    await (await store.stage(chunks('hello'), 1000)).commit()
    await store.remove(SHA_OF_HELLO)
    expect(existsSync(store.pathOf(SHA_OF_HELLO))).toBe(false)
    await expect(store.remove(SHA_OF_HELLO)).resolves.toBeUndefined()
  })

  it('refuses a hash that could point outside the store', () => {
    const store = new FileSourceStore(root)
    expect(() => store.pathOf('../../etc/passwd')).toThrow(TypeError)
    expect(() => store.pathOf(`${SHA_OF_HELLO}/x`)).toThrow(TypeError)
    expect(() => store.pathOf(SHA_OF_HELLO.toUpperCase())).toThrow(TypeError)
  })
})
