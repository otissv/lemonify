import { describe, expect, it } from 'vitest'

import type { UserDao } from '../user-dao.ts'

export type UserDaoFixture = {
  dao: UserDao
  seedUser(user: {
    id: string
    name: string
    email: string
    createdAt: string
  }): Promise<void>
  close(): Promise<void>
}

/** Every UserDao implementation must pass these. */
export function userDaoContract(
  implementation: string,
  create: () => Promise<UserDaoFixture>,
): void {
  describe(`UserDao contract: ${implementation}`, () => {
    it('lists no users in an empty database', async () => {
      const { dao, close } = await create()
      expect(await dao.list()).toEqual([])
      await close()
    })

    it('lists users oldest first', async () => {
      const { dao, seedUser, close } = await create()
      await seedUser({
        id: 'b',
        name: 'Bea',
        email: 'bea@example.com',
        createdAt: '2026-02-01T00:00:00.000Z',
      })
      await seedUser({
        id: 'a',
        name: 'Ann',
        email: 'ann@example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
      const users = await dao.list()
      expect(users.map((user) => user.id)).toEqual(['a', 'b'])
      expect(users[0]).toEqual({
        id: 'a',
        name: 'Ann',
        email: 'ann@example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
      await close()
    })

    it('finds a user by id, or null', async () => {
      const { dao, seedUser, close } = await create()
      await seedUser({
        id: 'a',
        name: 'Ann',
        email: 'ann@example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
      expect((await dao.findById('a'))?.name).toBe('Ann')
      expect(await dao.findById('missing')).toBeNull()
      await close()
    })

    it('finds users by name or by email', async () => {
      const { dao, seedUser, close } = await create()
      await seedUser({
        id: 'a',
        name: 'Ann',
        email: 'ann@example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
      await seedUser({
        id: 'b',
        name: 'Ann',
        email: 'ann2@example.com',
        createdAt: '2026-01-02T00:00:00.000Z',
      })
      expect((await dao.findByNameOrEmail('Ann')).map((u) => u.id)).toEqual([
        'a',
        'b',
      ])
      expect(
        (await dao.findByNameOrEmail('ann2@example.com')).map((u) => u.id),
      ).toEqual(['b'])
      expect(await dao.findByNameOrEmail('nobody')).toEqual([])
      await close()
    })
  })
}
