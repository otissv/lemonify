import type { Knex } from 'knex'

import { schema } from './20261127000100-schema.ts'

export type Migration = {
  name: string
  up: (database: Knex) => Promise<void>
  down: (database: Knex) => Promise<void>
}

/** Every schema change, oldest first. Add new ones at the end, never edit old ones. */
export const MIGRATIONS: readonly Migration[] = [schema]
