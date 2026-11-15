import { createTestDatabase, insertTestUser } from '../testing/test-database'
import { workflowDaoContract } from './contract/workflow-dao.contract'
import { MemoryWorkflowDao } from './memory/workflow-dao'
import { SqliteWorkflowDao } from './sqlite/workflow-dao'

workflowDaoContract('memory', async () => ({
  dao: new MemoryWorkflowDao(),
  seedUser: async () => {},
  close: async () => {},
}))

workflowDaoContract('sqlite', async () => {
  const database = await createTestDatabase()
  const users = new Set<string>()
  return {
    dao: new SqliteWorkflowDao(database),
    seedUser: async (id) => {
      if (users.has(id)) return
      users.add(id)
      await insertTestUser(database, id)
    },
    close: () => database.destroy(),
  }
})
