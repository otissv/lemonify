import { describe, expect, it } from 'vitest'

import { createTestDatabase, insertTestUser } from '../testing/test-database'
import { DataIntegrityError } from '../errors'
import { keybindingDaoContract } from './contract/keybinding-dao.contract'
import { MemoryKeybindingDao } from './memory/keybinding-dao'
import { SqliteKeybindingDao } from './sqlite/keybinding-dao'

keybindingDaoContract('memory', async () => ({
  dao: new MemoryKeybindingDao(),
  seedUser: async () => {},
  close: async () => {},
}))

keybindingDaoContract('sqlite', async () => {
  const database = await createTestDatabase()
  const users = new Set<string>()
  return {
    dao: new SqliteKeybindingDao(database),
    seedUser: async (id) => {
      if (users.has(id)) return
      users.add(id)
      await insertTestUser(database, id)
    },
    close: () => database.destroy(),
  }
})

describe('the sqlite KeybindingDao', () => {
  it('drops stored entries that are no longer valid instead of failing', async () => {
    const database = await createTestDatabase()
    await insertTestUser(database, 'ann')
    const dao = new SqliteKeybindingDao(database)
    await database('keybindings').insert({
      owner_id: 'ann',
      bindings:
        '{"version":1,"bindings":{"edit.nope":["a"],"edit.undo":["mod+w"],"view.fit":["alt+z"]}}',
      updated_at: '2026-01-01T00:00:00.000Z',
    })
    expect((await dao.findByOwner('ann'))?.overrides.bindings).toEqual({
      'view.fit': ['alt+z'],
    })
    await database.destroy()
  })

  it('refuses a stored file that is not valid, rather than guessing', async () => {
    const database = await createTestDatabase()
    await insertTestUser(database, 'ann')
    const dao = new SqliteKeybindingDao(database)
    const now = '2026-01-01T00:00:00.000Z'
    await database('keybindings').insert({
      owner_id: 'ann',
      bindings: 'nope',
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
    await database.destroy()
  })

  it('removes a User’s record when the User is deleted', async () => {
    const database = await createTestDatabase()
    await insertTestUser(database, 'ann')
    const dao = new SqliteKeybindingDao(database)
    await dao.save({
      ownerId: 'ann',
      overrides: { version: 1, bindings: {} },
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    await database('user').where({ id: 'ann' }).delete()
    expect(await database('keybindings').count({ n: '*' })).toEqual([{ n: 0 }])
    await database.destroy()
  })
})
