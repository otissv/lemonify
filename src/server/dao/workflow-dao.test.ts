import { describe, expect, it } from 'vitest'

import { DataIntegrityError } from '../errors'
import { createTestDatabase, insertTestUser } from '../testing/test-database'
import { workflowDaoContract } from './contract/workflow-dao.contract'
import { MemoryWorkflowDao } from './memory/workflow-dao'
import { PostgresWorkflowDao } from './postgres/workflow-dao'

workflowDaoContract('memory', async () => ({
  dao: new MemoryWorkflowDao(),
  seedUser: async () => {},
  close: async () => {},
}))

workflowDaoContract('postgres', async () => {
  const { database, close } = await createTestDatabase()
  const users = new Set<string>()
  return {
    dao: new PostgresWorkflowDao(database),
    seedUser: async (id) => {
      if (users.has(id)) return
      users.add(id)
      await insertTestUser(database, id)
    },
    close,
  }
})

describe('a workflow saved before pipelines', () => {
  it('cannot be read, since there is no migration of its graph', async () => {
    const { database, close } = await createTestDatabase()
    await insertTestUser(database, 'ann')
    await database('workflows').insert({
      id: 'old',
      owner_id: 'ann',
      name: 'Old',
      definition: JSON.stringify({ nodes: [], edges: [] }),
      revision: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    })

    await expect(
      new PostgresWorkflowDao(database).findById('old'),
    ).rejects.toBeInstanceOf(DataIntegrityError)
    await close()
  })
})
