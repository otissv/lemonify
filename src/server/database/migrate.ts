import type { Knex } from 'knex'

import { MIGRATIONS } from '../../../migrations/index.ts'

type MigrationSource = Knex.MigrationSource<string>

/**
 * The migrations are imported, not found by scanning a folder, so the same
 * list runs under Vite, Vitest and the CLI.
 */
const source: MigrationSource = {
  getMigrations: async () => MIGRATIONS.map((migration) => migration.name),
  getMigrationName: (name) => name,
  getMigration: async (name) => {
    const migration = MIGRATIONS.find((entry) => entry.name === name)
    if (!migration) throw new Error(`Unknown migration ${name}`)
    return { up: migration.up, down: migration.down }
  },
}

export async function migrateToLatest(database: Knex): Promise<string[]> {
  const [, applied] = await database.migrate.latest({
    migrationSource: source,
  })
  return applied
}
