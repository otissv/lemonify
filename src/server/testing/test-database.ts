import { randomBytes } from 'node:crypto'

import type { Knex } from 'knex'
import { inject } from 'vitest'

import { loadConfig } from '../config/config.ts'
import type { DatabaseConfig } from '../config/config.ts'
import { readEnvironment } from '../config/environment.ts'
import {
  createDatabase,
  databasesStartingWith,
  dropDatabase,
} from '../database/admin.ts'
import { openDatabase } from '../database/connection.ts'
import { migrateToLatest } from '../database/migrate.ts'

/** Enough connections for a test to run two transactions at once. */
const TEST_POOL_SIZE = 4
/** Every test run's database names start with it. */
const TEST_DATABASE_PREFIX = 'lemonify_test'

declare module 'vitest' {
  interface ProvidedContext {
    /** The test run's id, which its database names start with, so two runs at once keep apart. */
    testRun: string
  }
}

export type TestDatabase = {
  database: Knex
  /** Where it is, for a second pool (Better Auth's) or a whole app on it. */
  config: DatabaseConfig
  /** Closes the pool and drops the database. */
  close(): Promise<void>
}

/**
 * The Postgres server in the POSTGRES_ settings. Tests never use the
 * database the settings name: Vitest points it at one that does not exist
 * (vitest.config.ts), so a test that forgets to make its own fails instead of
 * changing real data.
 */
function testServer(): DatabaseConfig {
  return { ...loadConfig(readEnvironment()).database, poolSize: TEST_POOL_SIZE }
}

/** The migrated database every test database of the run is copied from. */
function templateName(run: string): string {
  return `${TEST_DATABASE_PREFIX}_${run}`
}

/**
 * Creates the run's template and migrates it, once per test run (Vitest's
 * global setup), so each test database is a quick copy of the latest schema.
 */
export async function createTemplateDatabase(run: string): Promise<void> {
  const server = testServer()
  const template = templateName(run)
  await createDatabase(server, template)
  const database = openDatabase({ ...server, database: template })
  try {
    await migrateToLatest(database)
  } finally {
    await database.destroy()
  }
}

/** Drops every database the run left behind, its template last. */
export async function dropTestDatabases(run: string): Promise<void> {
  const server = testServer()
  const template = templateName(run)
  for (const name of await databasesStartingWith(server, `${template}_`)) {
    await dropDatabase(server, name)
  }
  await dropDatabase(server, template)
}

/** A database of its own with every migration applied, copied from the template. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const server = testServer()
  const template = templateName(inject('testRun'))
  const name = `${template}_${randomBytes(8).toString('hex')}`
  await createDatabase(server, name, template)
  const config = { ...server, database: name }
  const database = openDatabase(config)
  return {
    database,
    config,
    async close() {
      await database.destroy()
      await dropDatabase(server, name)
    },
  }
}

/** Inserts a user row the way Better Auth stores one, for tests that need an owner. */
export async function insertTestUser(
  database: Knex,
  id: string,
  name = id,
): Promise<void> {
  const now = new Date().toISOString()
  await database('user').insert({
    id,
    name,
    email: `${id}@test.invalid`,
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
  })
}
