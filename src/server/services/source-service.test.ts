import { beforeEach, describe, expect, it } from 'vitest'

import { MemorySourceDao } from '../dao/memory/source-dao'
import { MemoryStore } from '../dao/memory/store'
import {
  ConflictError,
  LimitError,
  NotFoundError,
  ValidationError,
} from '../errors'
import {
  FakeImageInspector,
  FixedClock,
  MemorySourceStore,
  SequenceIds,
  bytesOf,
  sha256,
} from '../testing/fakes'
import { SourceService, cleanFileName } from './source-service'

const ANN = { userId: 'ann', name: 'Ann' }
const BEA = { userId: 'bea', name: 'Bea' }
const HOUR = 3_600_000

let memory: MemoryStore
let store: MemorySourceStore
let inspector: FakeImageInspector
let clock: FixedClock
let service: SourceService

beforeEach(() => {
  memory = new MemoryStore()
  store = new MemorySourceStore()
  inspector = new FakeImageInspector()
  clock = new FixedClock()
  service = new SourceService({
    sources: new MemorySourceDao(memory),
    store,
    inspector,
    clock,
    ids: new SequenceIds('src'),
    maxUploadBytes: 100,
  })
})

describe('SourceService.upload', () => {
  it('stores the file under its hash and records the Source from what the file is', async () => {
    inspector.info = { mediaType: 'image/webp', width: 30, height: 40 }
    const source = await service.upload(ANN, bytesOf('hello'), 'photo.png')
    expect(source).toMatchObject({
      id: 'src-1',
      ownerId: 'ann',
      contentHash: sha256('hello'),
      fileName: 'photo.png',
      mediaType: 'image/webp',
      bytes: 5,
      width: 30,
      height: 40,
    })
    expect(store.files.has(sha256('hello'))).toBe(true)
    expect(store.staged.size).toBe(0)
  })

  it('returns the same Source when the same image is uploaded again', async () => {
    const first = await service.upload(ANN, bytesOf('hello'), 'a.png')
    const second = await service.upload(ANN, bytesOf('hello'), 'b.png')
    expect(second.id).toBe(first.id)
    expect(await service.list(ANN)).toHaveLength(1)
  })

  it('gives each User their own Source for the same image, sharing one file', async () => {
    const a = await service.upload(ANN, bytesOf('hello'), 'a.png')
    const b = await service.upload(BEA, bytesOf('hello'), 'a.png')
    expect(a.id).not.toBe(b.id)
    expect(store.files.size).toBe(1)
  })

  it('refuses something that is not an image and leaves nothing behind', async () => {
    inspector.refused.add(sha256('nope'))
    await expect(service.upload(ANN, bytesOf('nope'), 'x.png')).rejects.toThrow(
      ValidationError,
    )
    expect(store.files.size).toBe(0)
    expect(store.staged.size).toBe(0)
    expect(await service.list(ANN)).toEqual([])
  })

  it('refuses an upload over the size limit', async () => {
    await expect(
      service.upload(ANN, bytesOf('x'.repeat(101)), 'big.png'),
    ).rejects.toThrow(LimitError)
    expect(store.staged.size).toBe(0)
  })

  it('cleans the file name it was given', () => {
    expect(cleanFileName('../../etc/passwd')).toBe('passwd')
    expect(cleanFileName('C:\\Users\\ann\\cat.png')).toBe('cat.png')
    expect(cleanFileName('  ')).toBe('image')
    expect(cleanFileName('..')).toBe('image')
    expect(cleanFileName('a\u0000b\u0007c.png')).toBe('abc.png')
    expect(cleanFileName('x'.repeat(500))).toHaveLength(200)
  })
})

describe('SourceService reads', () => {
  it('lists and opens only the User’s own Sources', async () => {
    const source = await service.upload(ANN, bytesOf('hello'), 'a.png')
    expect(await service.list(BEA)).toEqual([])
    await expect(service.get(BEA, source.id)).rejects.toThrow(NotFoundError)
    await expect(service.open(BEA, source.id)).rejects.toThrow(NotFoundError)
    await expect(service.pathOf(BEA, source.id)).rejects.toThrow(NotFoundError)
    const opened = await service.open(ANN, source.id)
    expect(opened).toMatchObject({
      mediaType: 'image/png',
      fileName: 'a.png',
      bytes: 5,
    })
    expect(await service.pathOf(ANN, source.id)).toBe(
      `memory://${sha256('hello')}`,
    )
  })

  it('says a missing Source does not exist, as it does for another User’s', async () => {
    await expect(service.get(ANN, 'nope')).rejects.toThrow(
      'That image does not exist.',
    )
  })
})

describe('SourceService.delete', () => {
  it('forgets an unused Source and leaves its file for the sweep', async () => {
    const source = await service.upload(ANN, bytesOf('hello'), 'a.png')
    await service.delete(ANN, source.id)
    expect(await service.list(ANN)).toEqual([])
    expect(store.files.has(sha256('hello'))).toBe(true)
  })

  it('refuses a Source another User owns, as if it did not exist', async () => {
    const source = await service.upload(ANN, bytesOf('hello'), 'a.png')
    await expect(service.delete(BEA, source.id)).rejects.toThrow(NotFoundError)
  })

  it('refuses while a Document uses it', async () => {
    const source = await service.upload(ANN, bytesOf('hello'), 'a.png')
    memory.documents.set('doc', {
      id: 'doc',
      ownerId: 'ann',
      sourceId: source.id,
      name: 'n',
      pipeline: { steps: [] },
      revision: 0,
      historyCursor: 0,
      createdAt: '',
      updatedAt: '',
    })
    await expect(service.delete(ANN, source.id)).rejects.toThrow(ConflictError)
  })
})

describe('SourceService.sweepOrphans', () => {
  it('removes old files no Source points at, and keeps referenced and recent ones', async () => {
    const kept = await service.upload(ANN, bytesOf('kept'), 'k.png')
    await service.upload(ANN, bytesOf('gone'), 'g.png')
    const goneHash = sha256('gone')
    const recentHash = sha256('recent')
    await service.delete(ANN, 'src-2')
    store.files.set(recentHash, Buffer.from('recent'))
    const now = clock.now().getTime()
    store.modified.set(sha256('kept'), now - 2 * HOUR)
    store.modified.set(goneHash, now - 2 * HOUR)
    store.modified.set(recentHash, now - 60_000)

    expect(await service.sweepOrphans(HOUR)).toBe(1)
    expect(store.files.has(goneHash)).toBe(false)
    expect(store.files.has(sha256('kept'))).toBe(true)
    expect(store.files.has(recentHash)).toBe(true)
    expect(kept.id).toBe('src-1')
  })
})
