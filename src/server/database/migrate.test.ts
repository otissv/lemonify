import { getMigrations } from 'better-auth/db/migration'
import pg from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MIGRATIONS } from '../../../migrations/index'
import { createTestDatabase } from '../testing/test-database'
import type { TestDatabase } from '../testing/test-database'
import { connectionSettings } from './connection'
import { migrateToLatest } from './migrate'

const TABLES = [
  'user',
  'session',
  'account',
  'verification',
  'sources',
  'documents',
  'document_operands',
  'history_entries',
  'workflows',
  'workflow_history',
  'workflow_runs',
  'jobs',
  'results',
  'keybindings',
]

let test: TestDatabase

beforeEach(async () => {
  test = await createTestDatabase()
})

afterEach(async () => {
  await test.close()
})

async function columnType(table: string, column: string): Promise<string> {
  const row: { data_type: string } | undefined = await test
    .database('information_schema.columns')
    .where({
      table_schema: test.config.schema,
      table_name: table,
      column_name: column,
    })
    .first('data_type')
  return row?.data_type ?? 'missing'
}

describe('migrations', () => {
  it('create every table in the plan', async () => {
    const rows: Array<{ table_name: string }> = await test
      .database('information_schema.tables')
      .where({ table_schema: test.config.schema })
      .select('table_name')
    const names = rows.map((row) => row.table_name)
    for (const table of TABLES) expect(names).toContain(table)
  })

  it('give JSON, flags, times and byte counts their Postgres types', async () => {
    expect(await columnType('documents', 'pipeline')).toBe('jsonb')
    expect(await columnType('jobs', 'payload')).toBe('jsonb')
    expect(await columnType('jobs', 'cancel_requested')).toBe('boolean')
    expect(await columnType('jobs', 'progress')).toBe('double precision')
    expect(await columnType('jobs', 'created_at')).toBe(
      'timestamp with time zone',
    )
    expect(await columnType('sources', 'bytes')).toBe('bigint')
    expect(await columnType('results', 'bytes')).toBe('bigint')
    expect(await columnType('user', 'emailVerified')).toBe('boolean')
  })

  it('are listed once each, in order', () => {
    const names = MIGRATIONS.map((migration) => migration.name)
    expect(new Set(names).size).toBe(names.length)
    expect([...names].sort()).toEqual(names)
  })

  it('run again without changing anything', async () => {
    expect(await migrateToLatest(test.database)).toEqual([])
  })

  it('leave nothing for Better Auth to create', async () => {
    const pool = new pg.Pool(connectionSettings(test.config))
    try {
      const { toBeCreated, toBeAdded } = await getMigrations({
        database: pool,
        secret: 's'.repeat(32),
        baseURL: 'http://localhost:3000',
        emailAndPassword: { enabled: true },
      })
      expect(toBeCreated).toEqual([])
      expect(toBeAdded).toEqual([])
    } finally {
      await pool.end()
    }
  })

  it('enforce foreign keys', async () => {
    await expect(
      test.database('sources').insert({
        id: 's1',
        owner_id: 'nobody',
        content_hash: 'h',
        file_name: 'a.png',
        media_type: 'image/png',
        bytes: 1,
        width: 1,
        height: 1,
        created_at: new Date().toISOString(),
      }),
    ).rejects.toThrow(/foreign key/)
  })
})
