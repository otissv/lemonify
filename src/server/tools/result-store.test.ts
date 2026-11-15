import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FileResultStore } from './result-store'

const KEY = 'a'.repeat(64)
const OTHER_KEY = 'b'.repeat(64)

let root = ''
let work = ''
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'lemonify-results-'))
  work = mkdtempSync(path.join(os.tmpdir(), 'lemonify-work-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(work, { recursive: true, force: true })
})

function file(name: string, content: string): string {
  const target = path.join(work, name)
  writeFileSync(target, content)
  return target
}

describe('FileResultStore', () => {
  it('moves a finished file in under its key', async () => {
    const store = new FileResultStore(path.join(root, 'results'))
    const source = file('out.png', 'pixels')
    await store.keep(source, KEY)
    expect(existsSync(source)).toBe(false)
    expect(readFileSync(store.pathOf(KEY), 'utf8')).toBe('pixels')
    expect(await store.has(KEY)).toBe(true)
    expect(await store.has(OTHER_KEY)).toBe(false)
  })

  it('keeps the stored file when the same key arrives again, and drops the newcomer', async () => {
    const store = new FileResultStore(root)
    await store.keep(file('a.png', 'first'), KEY)
    const again = file('b.png', 'second')
    await store.keep(again, KEY)
    expect(existsSync(again)).toBe(false)
    expect(readFileSync(store.pathOf(KEY), 'utf8')).toBe('first')
  })

  it('names a file by the hash of its content', async () => {
    const store = new FileResultStore(root)
    const key = await store.contentKey(file('hello.txt', 'hello'))
    expect(key).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
  })

  it('opens, lists and removes stored files', async () => {
    const store = new FileResultStore(root)
    expect(await store.list()).toEqual([])
    await store.keep(file('a.png', 'abc'), KEY)
    const chunks: Buffer[] = []
    for await (const piece of store.open(KEY)) chunks.push(piece as Buffer)
    expect(Buffer.concat(chunks).toString()).toBe('abc')
    expect((await store.list()).map((entry) => entry.key)).toEqual([KEY])
    await store.remove(KEY)
    expect(await store.has(KEY)).toBe(false)
    await expect(store.remove(KEY)).resolves.toBeUndefined()
  })

  it('refuses a key that could point outside the store', () => {
    const store = new FileResultStore(root)
    expect(() => store.pathOf('../x')).toThrow(TypeError)
    expect(() => store.pathOf(KEY.toUpperCase())).toThrow(TypeError)
  })
})
