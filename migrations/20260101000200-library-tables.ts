import type { Migration } from './index.ts'

export const libraryTables: Migration = {
  name: '20260101000200-library-tables',
  async up(database) {
    await database.schema.createTable('sources', (table) => {
      table.text('id').primary()
      table
        .text('owner_id')
        .notNullable()
        .references('id')
        .inTable('user')
        .onDelete('CASCADE')
      table.text('content_hash').notNullable()
      table.text('file_name').notNullable()
      table.text('media_type').notNullable()
      table.integer('bytes').notNullable()
      table.integer('width').notNullable()
      table.integer('height').notNullable()
      table.text('created_at').notNullable()
      table.unique(['owner_id', 'content_hash'])
      table.index(['content_hash'])
    })

    await database.schema.createTable('documents', (table) => {
      table.text('id').primary()
      table
        .text('owner_id')
        .notNullable()
        .references('id')
        .inTable('user')
        .onDelete('CASCADE')
      table
        .text('source_id')
        .notNullable()
        .references('id')
        .inTable('sources')
        .onDelete('RESTRICT')
      table.text('name').notNullable()
      table.text('pipeline').notNullable()
      table.integer('revision').notNullable().defaultTo(0)
      table.integer('history_cursor').notNullable().defaultTo(0)
      table.text('created_at').notNullable()
      table.text('updated_at').notNullable()
      table.index(['owner_id', 'updated_at'])
      table.index(['source_id'])
    })

    await database.schema.createTable('document_operands', (table) => {
      table
        .text('document_id')
        .notNullable()
        .references('id')
        .inTable('documents')
        .onDelete('CASCADE')
      table
        .text('source_id')
        .notNullable()
        .references('id')
        .inTable('sources')
        .onDelete('RESTRICT')
      table.primary(['document_id', 'source_id'])
      table.index(['source_id'])
    })

    await database.schema.createTable('history_entries', (table) => {
      table
        .text('document_id')
        .notNullable()
        .references('id')
        .inTable('documents')
        .onDelete('CASCADE')
      table.integer('position').notNullable()
      table.text('patch').notNullable()
      table.text('created_at').notNullable()
      table.primary(['document_id', 'position'])
    })
  },
  async down(database) {
    await database.schema.dropTableIfExists('history_entries')
    await database.schema.dropTableIfExists('document_operands')
    await database.schema.dropTableIfExists('documents')
    await database.schema.dropTableIfExists('sources')
  },
}
