import type { Knex } from 'knex'

import { authTables } from './20260101000100-auth-tables.ts'
import { libraryTables } from './20260101000200-library-tables.ts'
import { workTables } from './20260101000300-work-tables.ts'

export type Migration = {
  name: string
  up: (database: Knex) => Promise<void>
  down: (database: Knex) => Promise<void>
}

/** Every schema change, oldest first. Add new ones at the end, never edit old ones. */
export const MIGRATIONS: readonly Migration[] = [
  authTables,
  libraryTables,
  workTables,
]
