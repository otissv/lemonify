import { describe, expect, it } from 'vitest'

import { createSharpStep } from '@/features/pipeline/pipeline'
import type { HistoryPatch } from '@/features/pipeline/document-change'
import type { Pipeline } from '@/features/pipeline/pipeline'
import { ConflictError, NotFoundError } from '../../errors.ts'
import type { DocumentDao, DocumentRecord } from '../document-dao.ts'
import type { SourceDao, SourceRecord } from '../source-dao.ts'

export type LibraryFixture = {
  sources: SourceDao
  documents: DocumentDao
  seedUser(id: string): Promise<void>
  close(): Promise<void>
}

const T0 = '2026-01-01T00:00:00.000Z'
const T1 = '2026-01-02T00:00:00.000Z'
const T2 = '2026-01-03T00:00:00.000Z'
const MAX_ENTRIES = 100

/** A valid step id, as Pipelines require UUIDs. */
function stepUuid(name: string): string {
  const digits = [...name]
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
  return `00000000-0000-4000-8000-${digits.padEnd(12, '0').slice(0, 12)}`
}

export function source(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: 'src-1',
    ownerId: 'ann',
    contentHash: 'hash-1',
    fileName: 'one.png',
    mediaType: 'image/png',
    bytes: 100,
    width: 10,
    height: 20,
    createdAt: T0,
    ...overrides,
  }
}

export function documentRecord(
  overrides: Partial<DocumentRecord> = {},
): DocumentRecord {
  return {
    id: 'doc-1',
    ownerId: 'ann',
    name: 'One',
    pipeline: { steps: [] },
    revision: 0,
    historyCursor: 0,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  }
}

function addPatch(stepId: string): HistoryPatch {
  const step = { ...createSharpStep('blur'), id: stepUuid(stepId) }
  return {
    forward: { type: 'add-step', step, index: 0 },
    inverse: { type: 'remove-step', stepId: stepUuid(stepId) },
  }
}

function pipelineWith(stepId: string): Pipeline {
  return { steps: [{ ...createSharpStep('blur'), id: stepUuid(stepId) }] }
}

async function setup(create: () => Promise<LibraryFixture>) {
  const fixture = await create()
  await fixture.seedUser('ann')
  await fixture.seedUser('bea')
  await fixture.sources.insert(source())
  await fixture.documents.insert(documentRecord(), ['src-1'])
  return fixture
}

/** Every SourceDao and DocumentDao implementation must pass these. */
export function libraryDaoContract(
  implementation: string,
  create: () => Promise<LibraryFixture>,
): void {
  describe(`SourceDao contract: ${implementation}`, () => {
    it('stores a Source and finds it by id', async () => {
      const { sources, seedUser, close } = await create()
      await seedUser('ann')
      const result = await sources.insert(source())
      expect(result).toEqual({ source: source(), created: true })
      expect(await sources.findById('src-1')).toEqual(source())
      expect(await sources.findById('missing')).toBeNull()
      await close()
    })

    it('returns the same Source when a User uploads the same image again', async () => {
      const { sources, seedUser, close } = await create()
      await seedUser('ann')
      await sources.insert(source())
      const again = await sources.insert(
        source({ id: 'src-2', fileName: 'copy.png' }),
      )
      expect(again.created).toBe(false)
      expect(again.source.id).toBe('src-1')
      expect(await sources.listByOwner('ann')).toHaveLength(1)
      await close()
    })

    it('keeps a separate Source for each User with the same image', async () => {
      const { sources, seedUser, close } = await create()
      await seedUser('ann')
      await seedUser('bea')
      await sources.insert(source())
      const other = await sources.insert(
        source({ id: 'src-2', ownerId: 'bea' }),
      )
      expect(other.created).toBe(true)
      expect(await sources.countByHash('hash-1')).toBe(2)
      await close()
    })

    it('lists only the owner’s Sources, newest first', async () => {
      const { sources, seedUser, close } = await create()
      await seedUser('ann')
      await seedUser('bea')
      await sources.insert(
        source({ id: 'a', contentHash: 'h-a', createdAt: T0 }),
      )
      await sources.insert(
        source({ id: 'b', contentHash: 'h-b', createdAt: T2 }),
      )
      await sources.insert(
        source({ id: 'c', contentHash: 'h-c', ownerId: 'bea' }),
      )
      expect((await sources.listByOwner('ann')).map((s) => s.id)).toEqual([
        'b',
        'a',
      ])
      await close()
    })

    it('deletes an unused Source and counts hashes', async () => {
      const { sources, seedUser, close } = await create()
      await seedUser('ann')
      await sources.insert(source())
      expect(await sources.isReferenced('src-1')).toBe(false)
      await sources.delete('src-1')
      expect(await sources.findById('src-1')).toBeNull()
      expect(await sources.countByHash('hash-1')).toBe(0)
      await close()
    })

    it('knows a Source is used by a Document, as its image or as an operand, and refuses to delete it', async () => {
      const { sources, documents, close } = await setup(create)
      expect(await sources.isReferenced('src-1')).toBe(true)
      await expect(sources.delete('src-1')).rejects.toThrow()

      await sources.insert(source({ id: 'src-2', contentHash: 'hash-2' }))
      expect(await sources.isReferenced('src-2')).toBe(false)
      await documents.applyChange({
        id: 'doc-1',
        expectedRevision: 0,
        pipeline: pipelineWith('s1'),
        operandSourceIds: ['src-2'],
        patch: addPatch('s1'),
        maxEntries: MAX_ENTRIES,
        now: T1,
      })
      expect(await sources.isReferenced('src-2')).toBe(true)
      await expect(sources.delete('src-2')).rejects.toThrow()
      await close()
    })
  })

  describe(`DocumentDao contract: ${implementation}`, () => {
    it('stores a Document and finds it by id', async () => {
      const { documents, close } = await setup(create)
      expect(await documents.findById('doc-1')).toEqual(documentRecord())
      expect(await documents.findById('missing')).toBeNull()
      await close()
    })

    it('lists only the owner’s Documents, most recently changed first', async () => {
      const { documents, seedUser, sources, close } = await setup(create)
      await sources.insert(
        source({ id: 'src-b', ownerId: 'bea', contentHash: 'hb' }),
      )
      await documents.insert(documentRecord({ id: 'doc-2', updatedAt: T2 }), [
        'src-1',
      ])
      await documents.insert(documentRecord({ id: 'doc-3', ownerId: 'bea' }), [
        'src-b',
      ])
      await seedUser('ann')
      expect((await documents.listByOwner('ann')).map((d) => d.id)).toEqual([
        'doc-2',
        'doc-1',
      ])
      await close()
    })

    it('renames a Document and refuses a missing one', async () => {
      const { documents, close } = await setup(create)
      const renamed = await documents.rename('doc-1', 'Renamed', T1)
      expect(renamed).toMatchObject({
        name: 'Renamed',
        updatedAt: T1,
        revision: 0,
      })
      await expect(documents.rename('missing', 'x', T1)).rejects.toThrow(
        NotFoundError,
      )
      await close()
    })

    it('records a change: new Pipeline, entry at the cursor, revision up by one', async () => {
      const { documents, close } = await setup(create)
      const changed = await documents.applyChange({
        id: 'doc-1',
        expectedRevision: 0,
        pipeline: pipelineWith('s1'),
        operandSourceIds: [],
        patch: addPatch('s1'),
        maxEntries: MAX_ENTRIES,
        now: T1,
      })
      expect(changed).toMatchObject({
        revision: 1,
        historyCursor: 1,
        updatedAt: T1,
      })
      expect(changed.pipeline).toEqual(pipelineWith('s1'))
      const entry = await documents.findEntry('doc-1', 0)
      expect(entry?.patch).toEqual(addPatch('s1'))
      expect(await documents.findEntry('doc-1', 1)).toBeNull()
      await close()
    })

    it('refuses a change made on an old revision, changing nothing', async () => {
      const { documents, close } = await setup(create)
      const change = {
        id: 'doc-1',
        pipeline: pipelineWith('s1'),
        operandSourceIds: [],
        patch: addPatch('s1'),
        maxEntries: MAX_ENTRIES,
        now: T1,
      }
      await documents.applyChange({ ...change, expectedRevision: 0 })
      await expect(
        documents.applyChange({ ...change, expectedRevision: 0 }),
      ).rejects.toThrow(ConflictError)
      expect((await documents.findById('doc-1'))?.revision).toBe(1)
      await expect(
        documents.applyChange({
          ...change,
          id: 'missing',
          expectedRevision: 0,
        }),
      ).rejects.toThrow(NotFoundError)
      await close()
    })

    it('drops the undone entries when a new change is made after an undo', async () => {
      const { documents, close } = await setup(create)
      const base = {
        id: 'doc-1',
        operandSourceIds: [],
        maxEntries: MAX_ENTRIES,
      }
      await documents.applyChange({
        ...base,
        expectedRevision: 0,
        pipeline: pipelineWith('s1'),
        patch: addPatch('s1'),
        now: T1,
      })
      await documents.applyChange({
        ...base,
        expectedRevision: 1,
        pipeline: pipelineWith('s2'),
        patch: addPatch('s2'),
        now: T1,
      })
      await documents.moveCursor({
        id: 'doc-1',
        expectedRevision: 2,
        pipeline: pipelineWith('s1'),
        operandSourceIds: [],
        cursor: 1,
        now: T2,
      })
      const after = await documents.applyChange({
        ...base,
        expectedRevision: 3,
        pipeline: pipelineWith('s3'),
        patch: addPatch('s3'),
        now: T2,
      })
      expect(after.historyCursor).toBe(2)
      expect((await documents.findEntry('doc-1', 1))?.patch).toEqual(
        addPatch('s3'),
      )
      expect(await documents.findEntry('doc-1', 2)).toBeNull()
      await close()
    })

    it('moves the cursor and the Pipeline for undo and redo, raising the revision', async () => {
      const { documents, close } = await setup(create)
      await documents.applyChange({
        id: 'doc-1',
        expectedRevision: 0,
        pipeline: pipelineWith('s1'),
        operandSourceIds: [],
        patch: addPatch('s1'),
        maxEntries: MAX_ENTRIES,
        now: T1,
      })
      const undone = await documents.moveCursor({
        id: 'doc-1',
        expectedRevision: 1,
        pipeline: { steps: [] },
        operandSourceIds: [],
        cursor: 0,
        now: T2,
      })
      expect(undone).toMatchObject({ revision: 2, historyCursor: 0 })
      expect(undone.pipeline).toEqual({ steps: [] })
      expect(await documents.findEntry('doc-1', 0)).not.toBeNull()
      await expect(
        documents.moveCursor({
          id: 'doc-1',
          expectedRevision: 1,
          pipeline: { steps: [] },
          operandSourceIds: [],
          cursor: 0,
          now: T2,
        }),
      ).rejects.toThrow(ConflictError)
      await close()
    })

    it('keeps at most the newest entries and drops the oldest', async () => {
      const { documents, close } = await setup(create)
      const total = 5
      const keep = 3
      for (let i = 0; i < total; i += 1) {
        await documents.applyChange({
          id: 'doc-1',
          expectedRevision: i,
          pipeline: pipelineWith(`s${i}`),
          operandSourceIds: [],
          patch: addPatch(`s${i}`),
          maxEntries: keep,
          now: T1,
        })
      }
      expect(await documents.findEntry('doc-1', 0)).toBeNull()
      expect(await documents.findEntry('doc-1', 1)).toBeNull()
      expect(await documents.findEntry('doc-1', 2)).not.toBeNull()
      expect(await documents.findEntry('doc-1', 4)).not.toBeNull()
      expect((await documents.findById('doc-1'))?.historyCursor).toBe(total)
      await close()
    })

    it('lists the Documents that use a Source as their image or an operand', async () => {
      const { documents, sources, close } = await setup(create)
      await sources.insert(source({ id: 'src-2', contentHash: 'hash-2' }))
      await documents.insert(documentRecord({ id: 'doc-2', updatedAt: T1 }), [
        'src-2',
      ])
      await documents.applyChange({
        id: 'doc-1',
        expectedRevision: 0,
        pipeline: pipelineWith('s1'),
        operandSourceIds: ['src-1', 'src-2'],
        patch: addPatch('s1'),
        maxEntries: MAX_ENTRIES,
        now: T2,
      })
      expect((await documents.listBySource('src-2')).map((d) => d.id)).toEqual([
        'doc-1',
        'doc-2',
      ])
      expect((await documents.listBySource('src-1')).map((d) => d.id)).toEqual([
        'doc-1',
      ])
      await close()
    })

    it('unlinks operands that a change no longer uses', async () => {
      const { documents, sources, close } = await setup(create)
      await sources.insert(source({ id: 'src-2', contentHash: 'hash-2' }))
      const base = { id: 'doc-1', maxEntries: MAX_ENTRIES, now: T1 }
      await documents.applyChange({
        ...base,
        expectedRevision: 0,
        pipeline: pipelineWith('s1'),
        operandSourceIds: ['src-2'],
        patch: addPatch('s1'),
      })
      await documents.applyChange({
        ...base,
        expectedRevision: 1,
        pipeline: pipelineWith('s2'),
        operandSourceIds: [],
        patch: addPatch('s2'),
      })
      expect(await sources.isReferenced('src-2')).toBe(false)
      await close()
    })

    it('deletes a Document with its History and operand links, never its Source', async () => {
      const { documents, sources, close } = await setup(create)
      await sources.insert(source({ id: 'src-2', contentHash: 'hash-2' }))
      await documents.applyChange({
        id: 'doc-1',
        expectedRevision: 0,
        pipeline: pipelineWith('s1'),
        operandSourceIds: ['src-2'],
        patch: addPatch('s1'),
        maxEntries: MAX_ENTRIES,
        now: T1,
      })
      await documents.delete('doc-1')
      expect(await documents.findById('doc-1')).toBeNull()
      expect(await documents.findEntry('doc-1', 0)).toBeNull()
      expect(await sources.isReferenced('src-2')).toBe(false)
      expect(await sources.findById('src-1')).not.toBeNull()
      await close()
    })
  })
}
