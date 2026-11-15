import type { Migration } from './index.ts'

export const workTables: Migration = {
  name: '20260101000300-work-tables',
  async up(database) {
    await database.schema.createTable('workflows', (table) => {
      table.text('id').primary()
      table
        .text('owner_id')
        .notNullable()
        .references('id')
        .inTable('user')
        .onDelete('CASCADE')
      table.text('name').notNullable()
      table.text('graph').notNullable()
      table.integer('revision').notNullable().defaultTo(0)
      table.text('created_at').notNullable()
      table.text('updated_at').notNullable()
      table.index(['owner_id', 'updated_at'])
    })

    await database.schema.createTable('workflow_runs', (table) => {
      table.text('id').primary()
      table
        .text('workflow_id')
        .references('id')
        .inTable('workflows')
        .onDelete('SET NULL')
      table
        .text('owner_id')
        .notNullable()
        .references('id')
        .inTable('user')
        .onDelete('CASCADE')
      table.text('graph').notNullable()
      table.text('state').notNullable()
      table.text('created_at').notNullable()
      table.text('finished_at')
      table.index(['owner_id', 'created_at'])
    })

    await database.schema.createTable('jobs', (table) => {
      table.text('id').primary()
      table.text('kind').notNullable()
      table
        .text('owner_id')
        .notNullable()
        .references('id')
        .inTable('user')
        .onDelete('CASCADE')
      table.text('pool').notNullable()
      table.integer('priority').notNullable()
      table.text('group_key').notNullable()
      table
        .text('document_id')
        .references('id')
        .inTable('documents')
        .onDelete('CASCADE')
      table
        .text('workflow_run_id')
        .references('id')
        .inTable('workflow_runs')
        .onDelete('CASCADE')
      table.text('state').notNullable()
      table.float('progress').notNullable().defaultTo(0)
      table.text('payload').notNullable()
      table.text('result')
      table.text('error')
      table.text('claimed_by')
      table.integer('cancel_requested').notNullable().defaultTo(0)
      table.text('created_at').notNullable()
      table.text('started_at')
      table.text('finished_at')
      table.index(['state', 'pool', 'priority', 'created_at'])
      table.index(['owner_id', 'state'])
      table.index(['group_key'])
      table.index(['document_id', 'kind', 'state'])
    })

    await database.schema.createTable('results', (table) => {
      table.text('id').primary()
      table
        .text('owner_id')
        .notNullable()
        .references('id')
        .inTable('user')
        .onDelete('CASCADE')
      table.text('kind').notNullable()
      table.text('key').notNullable()
      table
        .text('document_id')
        .references('id')
        .inTable('documents')
        .onDelete('CASCADE')
      table.text('step_id')
      table
        .text('workflow_run_id')
        .references('id')
        .inTable('workflow_runs')
        .onDelete('CASCADE')
      table.text('file_name').notNullable()
      table.text('media_type').notNullable()
      table.integer('bytes').notNullable()
      table.text('created_at').notNullable()
      table.index(['owner_id', 'created_at'])
      table.index(['key'])
      table.index(['document_id'])
    })
  },
  async down(database) {
    await database.schema.dropTableIfExists('results')
    await database.schema.dropTableIfExists('jobs')
    await database.schema.dropTableIfExists('workflow_runs')
    await database.schema.dropTableIfExists('workflows')
  },
}
