import { describe, expect, it } from 'vitest'

import type { ResultDao, ResultRecord } from '../result-dao.ts'

export type ResultFixture = {
  dao: ResultDao
  seedUser(id: string): Promise<void>
  /** Creates a Document the Results can belong to. */
  seedDocument(id: string, ownerId: string): Promise<void>
  close(): Promise<void>
}

const T0 = '2026-01-01T00:00:00.000Z'
const T1 = '2026-01-02T00:00:00.000Z'

export function result(overrides: Partial<ResultRecord> = {}): ResultRecord {
  return {
    id: 'res-1',
    ownerId: 'ann',
    kind: 'ai-step',
    key: 'key-1',
    documentId: null,
    stepId: null,
    workflowRunId: null,
    fileName: 'out.png',
    mediaType: 'image/png',
    bytes: 100,
    createdAt: T0,
    ...overrides,
  }
}

export function resultDaoContract(
  implementation: string,
  create: () => Promise<ResultFixture>,
): void {
  describe(`ResultDao contract: ${implementation}`, () => {
    it('stores a Result and finds it by id or by key', async () => {
      const { dao, seedUser, close } = await create()
      await seedUser('ann')
      await dao.insert(result())
      expect(await dao.findById('res-1')).toEqual(result())
      expect(await dao.findById('missing')).toBeNull()
      expect((await dao.findByKey('ann', 'key-1'))?.id).toBe('res-1')
      expect(await dao.findByKey('ann', 'other')).toBeNull()
      await close()
    })

    it('finds a Result by key only for its owner, and the newest if there are several', async () => {
      const { dao, seedUser, close } = await create()
      await seedUser('ann')
      await seedUser('bea')
      await dao.insert(result({ id: 'old', createdAt: T0 }))
      await dao.insert(result({ id: 'new', createdAt: T1 }))
      await dao.insert(result({ id: 'bea', ownerId: 'bea' }))
      expect((await dao.findByKey('ann', 'key-1'))?.id).toBe('new')
      expect((await dao.findByKey('bea', 'key-1'))?.id).toBe('bea')
      expect(await dao.countByKey('key-1')).toBe(3)
      await close()
    })

    it('lists the owner’s Results newest first, filtered by Document or kind', async () => {
      const { dao, seedUser, seedDocument, close } = await create()
      await seedUser('ann')
      await seedUser('bea')
      await seedDocument('doc-1', 'ann')
      await dao.insert(
        result({ id: 'a', key: 'a', documentId: 'doc-1', createdAt: T0 }),
      )
      await dao.insert(
        result({ id: 'b', key: 'b', kind: 'export', createdAt: T1 }),
      )
      await dao.insert(result({ id: 'c', key: 'c', ownerId: 'bea' }))
      expect((await dao.list('ann', {})).map((r) => r.id)).toEqual(['b', 'a'])
      expect(
        (await dao.list('ann', { documentId: 'doc-1' })).map((r) => r.id),
      ).toEqual(['a'])
      expect(
        (await dao.list('ann', { kind: 'export' })).map((r) => r.id),
      ).toEqual(['b'])
      await close()
    })

    it('adds up the bytes a User keeps', async () => {
      const { dao, seedUser, close } = await create()
      await seedUser('ann')
      await seedUser('bea')
      expect(await dao.sumBytes('ann')).toBe(0)
      await dao.insert(result({ id: 'a', key: 'a', bytes: 30 }))
      await dao.insert(result({ id: 'b', key: 'b', bytes: 12 }))
      await dao.insert(
        result({ id: 'c', key: 'c', ownerId: 'bea', bytes: 999 }),
      )
      expect(await dao.sumBytes('ann')).toBe(42)
      await close()
    })

    it('deletes one Result, or all of a Document’s', async () => {
      const { dao, seedUser, seedDocument, close } = await create()
      await seedUser('ann')
      await seedDocument('doc-1', 'ann')
      await dao.insert(result({ id: 'a', key: 'a', documentId: 'doc-1' }))
      await dao.insert(result({ id: 'b', key: 'b', documentId: 'doc-1' }))
      await dao.insert(result({ id: 'c', key: 'c' }))
      await dao.delete('c')
      expect(await dao.findById('c')).toBeNull()
      await dao.deleteForDocument('doc-1')
      expect(await dao.list('ann', {})).toEqual([])
      await close()
    })
  })
}
