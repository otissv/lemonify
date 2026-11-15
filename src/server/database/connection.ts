import { mkdirSync } from 'node:fs'
import path from 'node:path'

import knex from 'knex'
import type { Knex } from 'knex'
import type Database from 'better-sqlite3'

export const MEMORY_DATABASE = ':memory:'
const BUSY_TIMEOUT_MS = 5000

/** Settings every connection to the database file gets, whoever opens it. */
export function applyPragmas(connection: Database.Database): void {
  connection.pragma('journal_mode = WAL')
  connection.pragma('foreign_keys = ON')
  connection.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`)
}

/**
 * Opens the database through Knex on one connection. SQLite writes are
 * serialised anyway, and WAL mode with a busy timeout lets other processes
 * (the CLI beside the server) use the same file.
 */
export function openDatabase(file: string): Knex {
  if (file !== MEMORY_DATABASE)
    mkdirSync(path.dirname(file), { recursive: true })
  return knex({
    client: 'better-sqlite3',
    connection: { filename: file },
    useNullAsDefault: true,
    pool: {
      min: 1,
      max: 1,
      afterCreate(
        connection: Database.Database,
        done: (error: Error | null, connection: Database.Database) => void,
      ): void {
        applyPragmas(connection)
        done(null, connection)
      },
    },
  })
}
