import type { Knex } from 'knex'

import type { Migration } from './index.ts'

type Row = { id: string; owner_id: string }

/** Gives each owner's Documents a place in a list they can reorder, starting with the order they were listed in: most recently changed first. */
export const documentOrder: Migration = {
  name: '20260101000700-document-order',
  async up(database: Knex) {
    await database.schema.alterTable('documents', (table) => {
      table.integer('position').notNullable().defaultTo(0)
    })
    const rows: Row[] = await database('documents')
      .orderBy('owner_id', 'asc')
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'asc')
      .select('id', 'owner_id')
    const next = new Map<string, number>()
    for (const row of rows) {
      const position = next.get(row.owner_id) ?? 0
      next.set(row.owner_id, position + 1)
      await database('documents').where({ id: row.id }).update({ position })
    }
    await database.schema.alterTable('documents', (table) => {
      table.index(['owner_id', 'position'])
    })
  },
  async down(database: Knex) {
    await database.schema.alterTable('documents', (table) => {
      table.dropIndex(['owner_id', 'position'])
      table.dropColumn('position')
    })
  },
}
