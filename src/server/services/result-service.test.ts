import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MemoryResultDao } from '../dao/memory/result-dao'
import { LimitError, NotFoundError } from '../errors'
import {
  FixedClock,
  MemoryResultStore,
  RecordingPublisher,
  SequenceIds,
} from '../testing/fakes'
import { ResultService } from './result-service'

const ANN = { userId: 'ann', name: 'Ann' }
const BEA = { userId: 'bea', name: 'Bea' }
const KEY = 'a'.repeat(64)
const HOUR = 3_600_000

let work = ''
let store: MemoryResultStore
let clock: FixedClock
let service: ResultService
let publisher: RecordingPublisher

beforeEach(() => {
  work = mkdtempSync(path.join(os.tmpdir(), 'lemonify-result-svc-'))
  store = new MemoryResultStore()
  clock = new FixedClock()
  publisher = new RecordingPublisher()
  service = new ResultService({
    results: new MemoryResultDao(),
    store,
    clock,
    ids: new SequenceIds('res'),
    maxBytesPerUser: 100,
    changes: publisher,
  })
})
afterEach(() => rmSync(work, { recursive: true, force: true }))

function file(name: string, content: string): string {
  const target = path.join(work, name)
  writeFileSync(target, content)
  store.contents.set(target, content)
  return target
}

describe('ResultService.record', () => {
  it('keeps the file and records the Result under the key given', async () => {
    const record = await service.record(ANN, {
      kind: 'ai-step',
      key: KEY,
      documentId: 'doc-1',
      stepId: 'step-1',
      file: file('out.png', 'pixels'),
      fileName: 'out.png',
      mediaType: 'image/png',
    })
    expect(record).toMatchObject({
      id: 'res-1',
      ownerId: 'ann',
      kind: 'ai-step',
      key: KEY,
      documentId: 'doc-1',
      stepId: 'step-1',
      bytes: 6,
    })
    expect(store.files.get(KEY)).toBe('pixels')
  })

  it('names a Result by its content when no key is given', async () => {
    const record = await service.record(ANN, {
      kind: 'export',
      file: file('out.png', 'abc'),
      fileName: 'cat.png',
      mediaType: 'image/png',
    })
    expect(record.key).toMatch(/^[0-9a-f]{64}$/)
    expect(store.files.has(record.key)).toBe(true)
  })

  it('refuses a Result that would pass the User’s quota, keeping nothing', async () => {
    await service.record(ANN, {
      kind: 'export',
      file: file('a.png', 'x'.repeat(90)),
      fileName: 'a.png',
      mediaType: 'image/png',
    })
    await expect(
      service.record(ANN, {
        kind: 'export',
        file: file('b.png', 'y'.repeat(20)),
        fileName: 'b.png',
        mediaType: 'image/png',
      }),
    ).rejects.toThrow(LimitError)
    expect(store.files.size).toBe(1)
    await expect(service.assertWithinQuota(ANN)).resolves.toBeUndefined()
  })

  it('stops queueing work once the quota is full, and says what to do', async () => {
    await service.record(ANN, {
      kind: 'export',
      file: file('a.png', 'x'.repeat(100)),
      fileName: 'a.png',
      mediaType: 'image/png',
    })
    await expect(service.assertWithinQuota(ANN)).rejects.toThrow(
      /Delete results/,
    )
    await expect(service.assertWithinQuota(BEA)).resolves.toBeUndefined()
  })
})

describe('ResultService reads', () => {
  it('finds the stored file for a key only for the owner and only while the file exists', async () => {
    await service.record(ANN, {
      kind: 'ai-step',
      key: KEY,
      file: file('out.png', 'p'),
      fileName: 'o.png',
      mediaType: 'image/png',
    })
    expect(await service.findPath('ann', KEY)).toBe(`memory-results://${KEY}`)
    expect(await service.findPath('bea', KEY)).toBeUndefined()
    expect(await service.findPath('ann', 'b'.repeat(64))).toBeUndefined()
    store.files.delete(KEY)
    expect(await service.findPath('ann', KEY)).toBeUndefined()
  })

  it('lists, gets and opens only the User’s own Results', async () => {
    const record = await service.record(ANN, {
      kind: 'export',
      file: file('a.png', 'abc'),
      fileName: 'a.png',
      mediaType: 'image/png',
    })
    expect(await service.list(BEA)).toEqual([])
    expect((await service.list(ANN)).map((r) => r.id)).toEqual([record.id])
    await expect(service.get(BEA, record.id)).rejects.toThrow(NotFoundError)
    await expect(service.open(BEA, record.id)).rejects.toThrow(NotFoundError)
    const opened = await service.open(ANN, record.id)
    expect(opened).toMatchObject({
      fileName: 'a.png',
      mediaType: 'image/png',
      bytes: 3,
    })
    expect(await service.usedBytes(ANN)).toBe(3)
  })
})

describe('ResultService deletion', () => {
  it('deletes a Result row, frees the quota at once and leaves the file for the sweep', async () => {
    const record = await service.record(ANN, {
      kind: 'export',
      file: file('a.png', 'abc'),
      fileName: 'a.png',
      mediaType: 'image/png',
    })
    await service.delete(ANN, record.id)
    expect(await service.usedBytes(ANN)).toBe(0)
    expect(store.files.has(record.key)).toBe(true)
    await expect(service.delete(BEA, record.id)).rejects.toThrow(NotFoundError)
  })

  it('deletes the Results of a deleted Document', async () => {
    await service.record(ANN, {
      kind: 'ai-step',
      key: KEY,
      documentId: 'doc-1',
      file: file('a.png', 'abc'),
      fileName: 'a.png',
      mediaType: 'image/png',
    })
    await service.record(ANN, {
      kind: 'export',
      file: file('b.png', 'xyz'),
      fileName: 'b.png',
      mediaType: 'image/png',
    })
    await service.onDocumentDeleted(ANN, 'doc-1')
    expect((await service.list(ANN)).map((r) => r.kind)).toEqual(['export'])
  })

  it('sweeps old files that no Result points at', async () => {
    const kept = await service.record(ANN, {
      kind: 'export',
      file: file('a.png', 'abc'),
      fileName: 'a.png',
      mediaType: 'image/png',
    })
    store.files.set('c'.repeat(64), 'orphan')
    store.files.set('d'.repeat(64), 'recent orphan')
    const now = clock.now().getTime()
    store.modified.set(kept.key, now - 2 * HOUR)
    store.modified.set('c'.repeat(64), now - 2 * HOUR)
    store.modified.set('d'.repeat(64), now - 60_000)
    expect(await service.sweepOrphans(HOUR)).toBe(1)
    expect(store.files.has(kept.key)).toBe(true)
    expect(store.files.has('c'.repeat(64))).toBe(false)
    expect(store.files.has('d'.repeat(64))).toBe(true)
  })
})

describe('telling the person’s tabs', () => {
  const RESULT = {
    kind: 'export',
    fileName: 'a.png',
    mediaType: 'image/png',
  } as const

  it('says the results changed when one is recorded', async () => {
    await service.record(ANN, { ...RESULT, file: file('a.png', 'abc') })

    expect(publisher.eventsFor('ann')).toEqual([{ type: 'results.changed' }])
  })

  it('says the results changed when one is deleted', async () => {
    const record = await service.record(ANN, {
      ...RESULT,
      file: file('a.png', 'abc'),
    })
    publisher.clear()

    await service.delete(ANN, record.id)

    expect(publisher.eventsFor('ann')).toEqual([{ type: 'results.changed' }])
  })

  it('says the results changed when a document’s results go with it', async () => {
    await service.onDocumentDeleted(ANN, 'doc-1')

    expect(publisher.eventsFor('ann')).toEqual([{ type: 'results.changed' }])
  })

  it('says nothing when a result is refused, and tells only its owner', async () => {
    await expect(
      service.record(ANN, {
        ...RESULT,
        file: file('big.png', 'x'.repeat(500)),
      }),
    ).rejects.toThrow()
    await service.record(BEA, { ...RESULT, file: file('b.png', 'abc') })

    expect(publisher.eventsFor('ann')).toEqual([])
    expect(publisher.eventsFor('bea')).toEqual([{ type: 'results.changed' }])
  })
})
