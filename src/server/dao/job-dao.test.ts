import { createTestDatabase, insertTestUser } from '../testing/test-database'
import { documentRecord, source } from './contract/library-dao.contract'
import { jobDaoContract } from './contract/job-dao.contract'
import { MemoryJobDao } from './memory/job-dao'
import { SqliteDocumentDao } from './sqlite/document-dao'
import { SqliteJobDao } from './sqlite/job-dao'
import { SqliteSourceDao } from './sqlite/source-dao'

jobDaoContract('memory', async () => ({
  dao: new MemoryJobDao(),
  seedUser: async () => {},
  seedDocument: async () => {},
  close: async () => {},
}))

jobDaoContract('sqlite', async () => {
  const database = await createTestDatabase()
  const users = new Set<string>()
  const sources = new SqliteSourceDao(database)
  const documents = new SqliteDocumentDao(database)
  return {
    dao: new SqliteJobDao(database),
    seedUser: async (id) => {
      if (users.has(id)) return
      users.add(id)
      await insertTestUser(database, id)
    },
    seedDocument: async (id, ownerId) => {
      const sourceId = `src-${id}`
      await sources.insert(
        source({ id: sourceId, ownerId, contentHash: `h-${id}` }),
      )
      await documents.insert(documentRecord({ id, ownerId }), [sourceId])
    },
    close: () => database.destroy(),
  }
})
