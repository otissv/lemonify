import { createTestDatabase } from '../testing/test-database'
import { userDaoContract } from './contract/user-dao.contract'
import { MemoryUserDao } from './memory/user-dao'
import { PostgresUserDao } from './postgres/user-dao'

userDaoContract('memory', async () => {
  const dao = new MemoryUserDao()
  return {
    dao,
    seedUser: async (user) => dao.add(user),
    close: async () => {},
  }
})

userDaoContract('postgres', async () => {
  const { database, close } = await createTestDatabase()
  return {
    dao: new PostgresUserDao(database),
    seedUser: async (user) => {
      await database('user').insert({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: false,
        createdAt: user.createdAt,
        updatedAt: user.createdAt,
      })
    },
    close,
  }
})
