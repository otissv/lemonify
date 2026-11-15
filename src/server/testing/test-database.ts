import type { Knex } from 'knex'

import { MEMORY_DATABASE, openDatabase } from '../database/connection.ts'
import { migrateToLatest } from '../database/migrate.ts'

/** A fresh in-memory database with every migration applied. */
export async function createTestDatabase(): Promise<Knex> {
  const database = openDatabase(MEMORY_DATABASE)
  await migrateToLatest(database)
  return database
}

/** Inserts a user row the way Better Auth stores one, for tests that need an owner. */
export async function insertTestUser(
  database: Knex,
  id: string,
  name = id,
): Promise<void> {
  const now = Date.now()
  await database('user').insert({
    id,
    name,
    email: `${id}@test.invalid`,
    emailVerified: 0,
    createdAt: now,
    updatedAt: now,
  })
}
