import { DataIntegrityError } from '../errors'
import { createTestDatabase, insertTestUser } from '../testing/test-database'
import { libraryDaoContract } from './contract/library-dao.contract'
import { documentRecord, source } from './contract/library-dao.contract'
import { MemoryDocumentDao } from './memory/document-dao'
import { MemorySourceDao } from './memory/source-dao'
import { MemoryStore } from './memory/store'
import { PostgresDocumentDao } from './postgres/document-dao'
import { PostgresSourceDao } from './postgres/source-dao'
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

libraryDaoContract('postgres', async () => {
  const { database, close } = await createTestDatabase()
  const seeded = new Set<string>()
  return {
    sources: new PostgresSourceDao(database),
    documents: new PostgresDocumentDao(database),
    seedUser: async (id) => {
      if (seeded.has(id)) return
      seeded.add(id)
      await insertTestUser(database, id)
    },
    close,
  }
})

describe('PostgresDocumentDao', () => {
  it('reports stored edits that no longer match their schema as unreadable', async () => {
    const { database, close } = await createTestDatabase()
    await insertTestUser(database, 'ann')
    const sources = new PostgresSourceDao(database)
    const documents = new PostgresDocumentDao(database)
    await sources.insert(source())
    await documents.insert(documentRecord(), ['src-1'])
    await database('documents')
      .where({ id: 'doc-1' })
      .update({ pipeline: '{"steps":"nope"}' })
    await expect(documents.findById('doc-1')).rejects.toThrow(
      DataIntegrityError,
    )
    await expect(documents.findById('doc-1')).rejects.toThrow(
      /could not be read/,
    )
    await close()
  })

  it('refuses a Document that points at a Source that does not exist', async () => {
    const { database, close } = await createTestDatabase()
    await insertTestUser(database, 'ann')
    await expect(
      new PostgresDocumentDao(database).insert(documentRecord(), ['nope']),
    ).rejects.toThrow(/foreign key/)
    await close()
  })
})
