import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import Database from 'better-sqlite3'
import { getMigrations } from 'better-auth/db/migration'
import { afterEach, describe, expect, it } from 'vitest'

import { MIGRATIONS } from '../../../migrations/index'
import { createTestDatabase } from '../testing/test-database'
import { applyPragmas, openDatabase } from './connection'
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
  'workflow_runs',
  'jobs',
  'results',
]

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn()
})

describe('migrations', () => {
  it('create every table in the plan', async () => {
    const database = await createTestDatabase()
    const rows = await database('sqlite_master')
      .where({ type: 'table' })
      .select('name')
    const names = rows.map((row: { name: string }) => row.name)
    for (const table of TABLES) expect(names).toContain(table)
    await database.destroy()
  })

  it('are listed once each, in order', () => {
    const names = MIGRATIONS.map((migration) => migration.name)
    expect(new Set(names).size).toBe(names.length)
    expect([...names].sort()).toEqual(names)
  })

  it('run again without changing anything', async () => {
    const database = await createTestDatabase()
    expect(await migrateToLatest(database)).toEqual([])
    await database.destroy()
  })

  it('leave nothing for Better Auth to create', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'lemonify-auth-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    const file = path.join(dir, 'db.sqlite')
    const database = openDatabase(file)
    await migrateToLatest(database)
    await database.destroy()

    const handle = new Database(file)
    cleanup.push(() => handle.close())
    const { toBeCreated, toBeAdded } = await getMigrations({
      database: handle,
      secret: 's'.repeat(32),
      baseURL: 'http://localhost:3000',
      emailAndPassword: { enabled: true },
    })
    expect(toBeCreated).toEqual([])
    expect(toBeAdded).toEqual([])
  })

  it('enforces foreign keys and cascades', async () => {
    const database = await createTestDatabase()
    await expect(
      database('sources').insert({
        id: 's1',
        owner_id: 'nobody',
        content_hash: 'h',
        file_name: 'a.png',
        media_type: 'image/png',
        bytes: 1,
        width: 1,
        height: 1,
        created_at: 'now',
      }),
    ).rejects.toThrow(/FOREIGN KEY/)
    await database.destroy()
  })
})

describe('openDatabase', () => {
  it('uses WAL mode on a file and waits for locks', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'lemonify-wal-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    const handle = new Database(path.join(dir, 'x.sqlite'))
    cleanup.push(() => handle.close())
    applyPragmas(handle)
    expect(handle.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(handle.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(handle.pragma('busy_timeout', { simple: true })).toBe(5000)
  })
})
