import { createTestDatabase, insertTestUser } from '../testing/test-database'
import { documentRecord, source } from './contract/library-dao.contract'
import { resultDaoContract } from './contract/result-dao.contract'
import { MemoryResultDao } from './memory/result-dao'
import { SqliteDocumentDao } from './sqlite/document-dao'
import { SqliteResultDao } from './sqlite/result-dao'
import { SqliteSourceDao } from './sqlite/source-dao'

resultDaoContract('memory', async () => ({
  dao: new MemoryResultDao(),
  seedUser: async () => {},
  seedDocument: async () => {},
  close: async () => {},
}))

resultDaoContract('sqlite', async () => {
  const database = await createTestDatabase()
  const users = new Set<string>()
  const sources = new SqliteSourceDao(database)
  const documents = new SqliteDocumentDao(database)
  return {
    dao: new SqliteResultDao(database),
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
