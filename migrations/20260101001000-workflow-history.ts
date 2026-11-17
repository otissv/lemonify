import type { Knex } from 'knex'

import type { Migration } from './index.ts'

/** A workflow has an Edit history like a document: entries by position, and a cursor to the next one. */
export const workflowHistory: Migration = {
  name: '20260101001000-workflow-history',
  async up(database: Knex) {
    await database.schema.alterTable('workflows', (table) => {
      table.integer('history_cursor').notNullable().defaultTo(0)
    })
    await database.schema.createTable('workflow_history', (table) => {
      table
        .text('workflow_id')
        .notNullable()
        .references('id')
        .inTable('workflows')
        .onDelete('CASCADE')
      table.integer('position').notNullable()
      table.text('patch').notNullable()
      table.text('created_at').notNullable()
      table.primary(['workflow_id', 'position'])
    })
  },
  async down(database: Knex) {
    await database.schema.dropTableIfExists('workflow_history')
    await database.schema.alterTable('workflows', (table) => {
      table.dropColumn('history_cursor')
    })
  },
}
