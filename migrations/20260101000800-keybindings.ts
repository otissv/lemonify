import type { Knex } from 'knex'

import type { Migration } from './index.ts'

/** One row per User holding the key bindings they changed, as JSON; a User with no row has the defaults. */
export const keybindings: Migration = {
  name: '20260101000800-keybindings',
  async up(database: Knex) {
    await database.schema.createTable('keybindings', (table) => {
      table
        .text('owner_id')
        .primary()
        .references('id')
        .inTable('user')
        .onDelete('CASCADE')
      table.text('bindings').notNullable()
      table.text('updated_at').notNullable()
    })
  },
  async down(database: Knex) {
    await database.schema.dropTable('keybindings')
  },
}
