import { DataIntegrityError } from '../errors'
import { createTestDatabase, insertTestUser } from '../testing/test-database'
import { libraryDaoContract } from './contract/library-dao.contract'
import { documentRecord, source } from './contract/library-dao.contract'
import { MemoryDocumentDao } from './memory/document-dao'
import { MemorySourceDao } from './memory/source-dao'
import { MemoryStore } from './memory/store'
import { SqliteDocumentDao } from './sqlite/document-dao'
import { SqliteSourceDao } from './sqlite/source-dao'
import { describe, expect, it } from 'vitest'

libraryDaoContract('memory', async () => {
  const store = new MemoryStore()
  return {
    sources: new MemorySourceDao(store),
    documents: new MemoryDocumentDao(store),
    seedUser: async () => {},
    close: async () => {},
  }
})

libraryDaoContract('sqlite', async () => {
  const database = await createTestDatabase()
  const seeded = new Set<string>()
  return {
    sources: new SqliteSourceDao(database),
    documents: new SqliteDocumentDao(database),
    seedUser: async (id) => {
      if (seeded.has(id)) return
      seeded.add(id)
      await insertTestUser(database, id)
    },
    close: () => database.destroy(),
  }
})

describe('SqliteDocumentDao', () => {
  it('reports stored edits that no longer match their schema as unreadable', async () => {
    const database = await createTestDatabase()
    await insertTestUser(database, 'ann')
    const sources = new SqliteSourceDao(database)
    const documents = new SqliteDocumentDao(database)
    await sources.insert(source())
    await documents.insert(documentRecord())
    await database('documents')
      .where({ id: 'doc-1' })
      .update({ pipeline: '{"steps":"nope"}' })
    await expect(documents.findById('doc-1')).rejects.toThrow(
      DataIntegrityError,
    )
    await database('documents')
      .where({ id: 'doc-1' })
      .update({ pipeline: 'not json' })
    await expect(documents.findById('doc-1')).rejects.toThrow(
      /could not be read/,
    )
    await database.destroy()
  })

  it('refuses a Document that points at a Source that does not exist', async () => {
    const database = await createTestDatabase()
    await insertTestUser(database, 'ann')
    await expect(
      new SqliteDocumentDao(database).insert(
        documentRecord({ sourceId: 'nope' }),
      ),
    ).rejects.toThrow(/FOREIGN KEY/)
    await database.destroy()
  })
})
