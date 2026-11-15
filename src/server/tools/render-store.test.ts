import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FileRenderStore, RenderKind } from './render-store.ts'

const KEY = 'a'.repeat(64)
const OTHER_KEY = 'b'.repeat(64)

describe('FileRenderStore', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lemonify-render-store-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function store(
    renders: FileRenderStore,
    key: string,
    bytes: number,
    kind = RenderKind.Preview,
  ): Promise<string> {
    const target = await renders.reserve(kind, key)
    await writeFile(target.partial, Buffer.alloc(bytes))
    return renders.commit(target)
  }

  it('finds nothing for a key that was never stored', async () => {
    const renders = new FileRenderStore(root, 1000)
    expect(await renders.find(RenderKind.Preview, KEY)).toBeUndefined()
  })

  it('finds what was stored under a key and kind only', async () => {
    const renders = new FileRenderStore(root, 1000)
    const stored = await store(renders, KEY, 10)
    expect(await renders.find(RenderKind.Preview, KEY)).toBe(stored)
    expect(await renders.find(RenderKind.Thumbnail, KEY)).toBeUndefined()
  })

  it('never shows a render that is still being written', async () => {
    const renders = new FileRenderStore(root, 1000)
    const target = await renders.reserve(RenderKind.Preview, KEY)
    await writeFile(target.partial, Buffer.alloc(10))
    expect(await renders.find(RenderKind.Preview, KEY)).toBeUndefined()
    await renders.discard(target)
    expect(await readdir(path.join(root, RenderKind.Preview))).toEqual([])
  })

  it('removes the least recently used renders when over its size', async () => {
    const renders = new FileRenderStore(root, 25)
    const first = await store(renders, KEY, 10)
    await utimes(first, new Date(1000), new Date(1000))
    await store(renders, OTHER_KEY, 10)
    await store(renders, 'c'.repeat(64), 10)
    expect(await renders.find(RenderKind.Preview, KEY)).toBeUndefined()
    expect(await renders.find(RenderKind.Preview, OTHER_KEY)).toBeDefined()
  })

  it('counts a find as a use, so a render in use is kept', async () => {
    const renders = new FileRenderStore(root, 25)
    const first = await store(renders, KEY, 10)
    await utimes(first, new Date(1000), new Date(1000))
    const second = await store(renders, OTHER_KEY, 10)
    await utimes(second, new Date(2000), new Date(2000))
    await renders.find(RenderKind.Preview, KEY)
    await store(renders, 'c'.repeat(64), 10)
    expect(await renders.find(RenderKind.Preview, KEY)).toBeDefined()
    expect(await renders.find(RenderKind.Preview, OTHER_KEY)).toBeUndefined()
  })

  it('streams a stored render', async () => {
    const renders = new FileRenderStore(root, 1000)
    await store(renders, KEY, 7)
    const chunks: Buffer[] = []
    for await (const chunk of renders.open(RenderKind.Preview, KEY)) {
      chunks.push(Buffer.from(chunk))
    }
    expect(Buffer.concat(chunks).byteLength).toBe(7)
  })

  it('refuses a key that is not a hash', () => {
    const renders = new FileRenderStore(root, 1000)
    expect(() => renders.open(RenderKind.Preview, '../x')).toThrow(TypeError)
  })
})
