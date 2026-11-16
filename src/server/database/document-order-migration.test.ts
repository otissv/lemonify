import type { Knex } from 'knex'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MIGRATIONS } from '../../../migrations/index'
import { insertTestUser } from '../testing/test-database'
import { MEMORY_DATABASE, openDatabase } from './connection'

const OLD = MIGRATIONS.slice(0, 6)
const NEW = MIGRATIONS[6]
const NOW = '2026-01-01T00:00:00.000Z'

let open: Knex
beforeEach(async () => {
  open = openDatabase(MEMORY_DATABASE)
  for (const migration of OLD) await migration.up(open)
  for (const user of ['ann', 'bea']) {
    await insertTestUser(open, user)
    await open('sources').insert({
      id: `src-${user}`,
      owner_id: user,
      content_hash: user,
      file_name: `${user}.png`,
      media_type: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
      created_at: NOW,
    })
  }
})
afterEach(async () => {
  await open.destroy()
})

async function seed(
  id: string,
  owner: string,
  updatedAt: string,
): Promise<void> {
  await open('documents').insert({
    id,
    owner_id: owner,
    name: id,
    pipeline: JSON.stringify({ steps: [] }),
    created_at: NOW,
    updated_at: updatedAt,
  })
}

async function positions(): Promise<Record<string, number>> {
  const rows: Array<{ id: string; position: number }> = await open(
    'documents',
  ).select('id', 'position')
  return Object.fromEntries(rows.map((row) => [row.id, row.position]))
}

describe('the document order migration', () => {
  it('keeps the order each person saw: most recently changed first', async () => {
    await seed('old', 'ann', '2026-01-01T00:00:00.000Z')
    await seed('new', 'ann', '2026-03-01T00:00:00.000Z')
    await seed('mid', 'ann', '2026-02-01T00:00:00.000Z')
    await seed('only', 'bea', '2026-02-01T00:00:00.000Z')

    await NEW?.up(open)

    expect(await positions()).toEqual({ new: 0, mid: 1, old: 2, only: 0 })
  })

  it('can be undone', async () => {
    await seed('one', 'ann', NOW)
    await NEW?.up(open)

    await NEW?.down(open)

    expect(await open.schema.hasColumn('documents', 'position')).toBe(false)
  })
})
