import type { Knex } from 'knex'

import type { Migration } from './index.ts'

const NOTHING_USED = JSON.stringify({ documents: {}, workflows: {} })

/** A run keeps a copy of the documents and workflows its layers use, as they were when it started. Earlier runs used none. */
export const runUsedItems: Migration = {
  name: '20260101001200-run-used-items',
  async up(database: Knex) {
    await database.schema.alterTable('workflow_runs', (table) => {
      table.text('used').notNullable().defaultTo(NOTHING_USED)
    })
  },
  async down(database: Knex) {
    await database.schema.alterTable('workflow_runs', (table) => {
      table.dropColumn('used')
    })
  },
}
