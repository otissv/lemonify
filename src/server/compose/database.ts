import { mkdirSync } from 'node:fs'

import type { Knex } from 'knex'

import {
  renderCacheDir,
  resultsDir,
  sourcesDir,
  workDir,
} from '../config/config.ts'
import type { Config, DatabaseConfig } from '../config/config.ts'
import { openDatabase } from '../database/connection.ts'
import { migrateToLatest } from '../database/migrate.ts'
import { UnavailableError } from '../errors.ts'

/** Network errors, and the Postgres codes for a refused login, a missing database and a server still starting. */
const CONNECTION_FAILURES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  '28000',
  '28P01',
  '3D000',
  '57P03',
])

/** Creates the data folder and the stores in it, so every process finds them. */
export function prepareDataDirectories(config: Config): void {
  for (const dir of [
    config.dataDir,
    sourcesDir(config),
    resultsDir(config),
    renderCacheDir(config),
    workDir(config),
  ]) {
    mkdirSync(dir, { recursive: true })
  }
}

function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'KnexTimeoutError') return true
  return 'code' in error && CONNECTION_FAILURES.has(String(error.code))
}

/**
 * Opens the database and brings its schema up to date. A database that
 * cannot be reached stops the process with a message that says where it
 * looked and how to start the local one.
 */
export async function connectDatabase(settings: DatabaseConfig): Promise<Knex> {
  const database = openDatabase(settings)
  try {
    await migrateToLatest(database)
    return database
  } catch (error) {
    await database.destroy()
    if (!isConnectionFailure(error)) throw error
    const { host, port, database: name } = settings
    const reason = error instanceof Error ? error.message : String(error)
    throw new UnavailableError(
      `The database ${name} at ${host}:${port} could not be reached (${reason}). Start it with "docker compose up -d", or check the POSTGRES_ settings.`,
      { cause: error },
    )
  }
}
