import { describe, expect, it } from 'vitest'

import { createTestDatabase, insertTestUser } from '../testing/test-database'
import { DataIntegrityError } from '../errors'
import { keybindingDaoContract } from './contract/keybinding-dao.contract'
import { MemoryKeybindingDao } from './memory/keybinding-dao'
import { PostgresKeybindingDao } from './postgres/keybinding-dao'

keybindingDaoContract('memory', async () => ({
  dao: new MemoryKeybindingDao(),
  seedUser: async () => {},
  close: async () => {},
}))

keybindingDaoContract('postgres', async () => {
  const { database, close } = await createTestDatabase()
  const users = new Set<string>()
  return {
    dao: new PostgresKeybindingDao(database),
    seedUser: async (id) => {
      if (users.has(id)) return
      users.add(id)
      await insertTestUser(database, id)
    },
    close,
  }
})

describe('the Postgres KeybindingDao', () => {
  it('drops stored entries that are no longer valid instead of failing', async () => {
    const { database, close } = await createTestDatabase()
    await insertTestUser(database, 'ann')
    const dao = new PostgresKeybindingDao(database)
    await database('keybindings').insert({
      owner_id: 'ann',
      bindings:
        '{"version":1,"bindings":{"edit.nope":["a"],"edit.undo":["mod+w"],"view.fit":["alt+z"]}}',
      updated_at: '2026-01-01T00:00:00.000Z',
    })
    expect((await dao.findByOwner('ann'))?.overrides.bindings).toEqual({
      'view.fit': ['alt+z'],
    })
    await close()
  })

  it('refuses a stored file that is not valid, rather than guessing', async () => {
    const { database, close } = await createTestDatabase()
    await insertTestUser(database, 'ann')
    const dao = new PostgresKeybindingDao(database)
    const now = '2026-01-01T00:00:00.000Z'
    await database('keybindings').insert({
      owner_id: 'ann',
      bindings: '"nope"',
      updated_at: now,
    })
    await expect(dao.findByOwner('ann')).rejects.toBeInstanceOf(
      DataIntegrityError,
    )
    await database('keybindings').update({
      bindings: '{"version":9,"bindings":{}}',
    })
    await expect(dao.findByOwner('ann')).rejects.toBeInstanceOf(
      DataIntegrityError,
    )
    await close()
  })

  it('removes a User’s record when the User is deleted', async () => {
    const { database, close } = await createTestDatabase()
    await insertTestUser(database, 'ann')
    const dao = new PostgresKeybindingDao(database)
    await dao.save({
      ownerId: 'ann',
      overrides: { version: 1, bindings: {} },
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    await database('user').where({ id: 'ann' }).delete()
    expect(await database('keybindings').count({ n: '*' })).toEqual([{ n: 0 }])
    await close()
  })
})
