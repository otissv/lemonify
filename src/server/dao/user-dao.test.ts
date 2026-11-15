import { createTestDatabase } from '../testing/test-database'
import { userDaoContract } from './contract/user-dao.contract'
import { MemoryUserDao } from './memory/user-dao'
import { SqliteUserDao } from './sqlite/user-dao'

userDaoContract('memory', async () => {
  const dao = new MemoryUserDao()
  return {
    dao,
    seedUser: async (user) => dao.add(user),
    close: async () => {},
  }
})

userDaoContract('sqlite', async () => {
  const database = await createTestDatabase()
  return {
    dao: new SqliteUserDao(database),
    seedUser: async (user) => {
      await database('user').insert({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: 0,
        createdAt: new Date(user.createdAt).getTime(),
        updatedAt: new Date(user.createdAt).getTime(),
      })
    },
    close: () => database.destroy(),
  }
})
