import knex from 'knex'
import type { Knex } from 'knex'
import pg from 'pg'

import type { DatabaseConfig } from '../config/config.ts'

/** How long a statement waits for a row or table lock before it fails (decision 5, database waits). */
export const LOCK_TIMEOUT_MS = 5000
/** How long any one statement may run before Postgres stops it. */
export const STATEMENT_TIMEOUT_MS = 30_000

const TIMESTAMPTZ_OID = 1184
const INT8_OID = 20
const JSON_OID = 114
const JSONB_OID = 3802

function toIsoString(value: string): string {
  return new Date(value).toISOString()
}

function toSafeNumber(value: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number)) {
    throw new RangeError(
      `The database returned ${value}, which is too large to read as a number.`,
    )
  }
  return number
}

function keepText(value: string): string {
  return value
}

/**
 * How this pool reads Postgres values: times as UTC ISO strings, as the DAOs
 * store them; whole numbers as numbers; JSON as its text, so each DAO parses
 * and checks it. The parsers are this pool's own, so other pools on the same
 * server (Better Auth's) keep the driver's defaults.
 */
const TYPES = {
  getTypeParser(oid: number, format?: string) {
    if (oid === TIMESTAMPTZ_OID) return toIsoString
    if (oid === INT8_OID) return toSafeNumber
    if (oid === JSON_OID || oid === JSONB_OID) return keepText
    return pg.types.getTypeParser(oid, format === 'binary' ? 'binary' : 'text')
  },
}

/** The settings `pg` needs to reach the database, shared by every pool that opens it. */
export function connectionSettings(config: DatabaseConfig): pg.ClientConfig {
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    options: `-c search_path=${config.schema} -c lock_timeout=${LOCK_TIMEOUT_MS} -c statement_timeout=${STATEMENT_TIMEOUT_MS}`,
  }
}

/**
 * Opens the database through Knex with a pool of `poolSize` connections.
 * The driver is asynchronous, so a statement waiting for a lock is a pending
 * promise and never blocks the process; the timeouts end a long wait with an
 * error instead.
 */
export function openDatabase(config: DatabaseConfig): Knex {
  return knex({
    client: 'pg',
    connection: { ...connectionSettings(config), types: TYPES },
    searchPath: [config.schema],
    pool: { min: 0, max: config.poolSize },
  })
}
