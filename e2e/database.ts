import path from 'node:path'

import { E2E_DATA_DIR, E2E_DATABASE } from '../playwright.config.ts'
import { loadConfig } from '../src/server/config/config.ts'
import type { DatabaseConfig } from '../src/server/config/config.ts'
import { readEnvironment } from '../src/server/config/environment.ts'
import { createDatabase, dropDatabase } from '../src/server/database/admin.ts'

/** The data a command line process works on: a data folder and a database, both of the run's own. */
export type CliStore = { dataDir: string; database: string }

/** What the end-to-end server and its global setup work on. */
export const E2E_STORE: CliStore = {
  dataDir: path.resolve(E2E_DATA_DIR),
  database: E2E_DATABASE,
}

/** The Postgres server in the POSTGRES_ settings, with the database named `name`. */
export function storeDatabase(name: string): DatabaseConfig {
  return { ...loadConfig(readEnvironment()).database, database: name }
}

/** Drops the database if a run left it, and creates it empty; the app migrates it when it starts. */
export async function resetDatabase(name: string): Promise<void> {
  const server = storeDatabase(name)
  await dropDatabase(server, name)
  await createDatabase(server, name)
}

export async function removeDatabase(name: string): Promise<void> {
  await dropDatabase(storeDatabase(name), name)
}
