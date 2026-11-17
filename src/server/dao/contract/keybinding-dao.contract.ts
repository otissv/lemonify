import { describe, expect, it } from 'vitest'

import type { KeybindingDao, KeybindingRecord } from '../keybinding-dao.ts'

export type KeybindingDaoFixture = {
  dao: KeybindingDao
  seedUser(id: string): Promise<void>
  close(): Promise<void>
}

function record(
  ownerId: string,
  bindings: Record<string, string[]>,
  updatedAt = '2026-01-01T00:00:00.000Z',
): KeybindingRecord {
  return { ownerId, overrides: { version: 1, bindings }, updatedAt }
}

/** Every KeybindingDao implementation must pass these. */
export function keybindingDaoContract(
  implementation: string,
  create: () => Promise<KeybindingDaoFixture>,
): void {
  describe(`KeybindingDao contract: ${implementation}`, () => {
    it('finds nothing for a User who has changed nothing', async () => {
      const { dao, seedUser, close } = await create()
      await seedUser('ann')
      expect(await dao.findByOwner('ann')).toBeNull()
      await close()
    })

    it('saves a record and finds it again', async () => {
      const { dao, seedUser, close } = await create()
      await seedUser('ann')
      await dao.save(record('ann', { 'edit.redo': ['alt+r'], 'edit.undo': [] }))
      expect(await dao.findByOwner('ann')).toEqual(
        record('ann', { 'edit.redo': ['alt+r'], 'edit.undo': [] }),
      )
      await close()
    })

    it('replaces the whole record when it is saved again', async () => {
      const { dao, seedUser, close } = await create()
      await seedUser('ann')
      await dao.save(record('ann', { 'edit.redo': ['alt+r'] }))
      await dao.save(
        record('ann', { 'view.fit': ['alt+z'] }, '2026-02-01T00:00:00.000Z'),
      )
      expect(await dao.findByOwner('ann')).toEqual(
        record('ann', { 'view.fit': ['alt+z'] }, '2026-02-01T00:00:00.000Z'),
      )
      await close()
    })

    it('keeps each User’s record apart', async () => {
      const { dao, seedUser, close } = await create()
      await seedUser('ann')
      await seedUser('bob')
      await dao.save(record('ann', { 'edit.redo': ['alt+r'] }))
      expect(await dao.findByOwner('bob')).toBeNull()
      await dao.save(record('bob', { 'edit.redo': ['alt+t'] }))
      expect((await dao.findByOwner('ann'))?.overrides.bindings).toEqual({
        'edit.redo': ['alt+r'],
      })
      await close()
    })

    it('deletes a record, and deleting none is not an error', async () => {
      const { dao, seedUser, close } = await create()
      await seedUser('ann')
      await dao.save(record('ann', { 'edit.redo': ['alt+r'] }))
      await dao.deleteByOwner('ann')
      expect(await dao.findByOwner('ann')).toBeNull()
      await dao.deleteByOwner('ann')
      await close()
    })

    it('does not hand out the stored object itself', async () => {
      const { dao, seedUser, close } = await create()
      await seedUser('ann')
      await dao.save(record('ann', { 'edit.redo': ['alt+r'] }))
      const found = await dao.findByOwner('ann')
      found?.overrides.bindings['edit.redo']?.push('alt+q')
      expect((await dao.findByOwner('ann'))?.overrides.bindings).toEqual({
        'edit.redo': ['alt+r'],
      })
      await close()
    })
  })
}
