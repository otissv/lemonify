import { createTestDatabase, insertTestUser } from '../testing/test-database'
import { documentRecord, source } from './contract/library-dao.contract'
import { jobDaoContract } from './contract/job-dao.contract'
import { MemoryJobDao } from './memory/job-dao'
import { PostgresDocumentDao } from './postgres/document-dao'
import { PostgresJobDao } from './postgres/job-dao'
import { PostgresSourceDao } from './postgres/source-dao'

jobDaoContract('memory', async () => ({
  dao: new MemoryJobDao(),
  seedUser: async () => {},
  seedDocument: async () => {},
  close: async () => {},
}))

jobDaoContract('postgres', async () => {
  const { database, close } = await createTestDatabase()
  const users = new Set<string>()
  const sources = new PostgresSourceDao(database)
  const documents = new PostgresDocumentDao(database)
  return {
    dao: new PostgresJobDao(database),
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
    close,
  }
})
