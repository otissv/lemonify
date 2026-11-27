import type { Knex } from 'knex'

import type { Migration } from './index.ts'

/**
 * Better Auth's own tables, as its `getMigrations` generates them for
 * Postgres; `migrate.test` checks that nothing is left for it to create.
 */
const AUTH_STATEMENTS = [
  `create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null)`,
  `create table "session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade)`,
  `create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null)`,
  `create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null)`,
  `create index "session_userId_idx" on "session" ("userId")`,
  `create index "account_userId_idx" on "account" ("userId")`,
  `create index "verification_identifier_idx" on "verification" ("identifier")`,
]

const NOTHING_USED = JSON.stringify({ documents: {}, workflows: {} })

type Table = Knex.CreateTableBuilder

function owner(table: Table): void {
  table
    .text('owner_id')
    .notNullable()
    .references('id')
    .inTable('user')
    .onDelete('CASCADE')
}

/** A column naming a row of `parent`; the row goes when its parent does, unless `onDelete` says otherwise. */
function parent(
  table: Table,
  column: string,
  parentTable: string,
  onDelete: 'CASCADE' | 'RESTRICT' | 'SET NULL' = 'CASCADE',
): Knex.ReferencingColumnBuilder {
  return table
    .text(column)
    .references('id')
    .inTable(parentTable)
    .onDelete(onDelete)
}

/** The Edit history of a document or workflow: patches by position. */
function history(table: Table, column: string, parentTable: string): void {
  parent(table, column, parentTable).notNullable()
  table.integer('position').notNullable()
  table.jsonb('patch').notNullable()
  table.timestamp('created_at', { useTz: true }).notNullable()
  table.primary([column, 'position'])
}

async function libraryTables(database: Knex): Promise<void> {
  await database.schema.createTable('sources', (table) => {
    table.text('id').primary()
    owner(table)
    table.text('content_hash').notNullable()
    table.text('file_name').notNullable()
    table.text('media_type').notNullable()
    table.bigInteger('bytes').notNullable()
    table.integer('width').notNullable()
    table.integer('height').notNullable()
    table.timestamp('created_at', { useTz: true }).notNullable()
    table.unique(['owner_id', 'content_hash'])
    table.index(['content_hash'])
  })
  await database.schema.createTable('documents', (table) => {
    table.text('id').primary()
    owner(table)
    table.text('name').notNullable()
    table.jsonb('pipeline').notNullable()
    table.integer('revision').notNullable().defaultTo(0)
    table.integer('history_cursor').notNullable().defaultTo(0)
    table.timestamp('created_at', { useTz: true }).notNullable()
    table.timestamp('updated_at', { useTz: true }).notNullable()
    table.integer('position').notNullable().defaultTo(0)
    table.index(['owner_id', 'updated_at'])
    table.index(['owner_id', 'position'])
  })
  await database.schema.createTable('document_operands', (table) => {
    parent(table, 'document_id', 'documents').notNullable()
    parent(table, 'source_id', 'sources', 'RESTRICT').notNullable()
    table.primary(['document_id', 'source_id'])
    table.index(['source_id'])
  })
  await database.schema.createTable('history_entries', (table) => {
    history(table, 'document_id', 'documents')
  })
}

async function workflowTables(database: Knex): Promise<void> {
  await database.schema.createTable('workflows', (table) => {
    table.text('id').primary()
    owner(table)
    table.text('name').notNullable()
    table.jsonb('definition').notNullable()
    table.integer('revision').notNullable().defaultTo(0)
    table.integer('history_cursor').notNullable().defaultTo(0)
    table.timestamp('created_at', { useTz: true }).notNullable()
    table.timestamp('updated_at', { useTz: true }).notNullable()
    table.index(['owner_id', 'updated_at'])
  })
  await database.schema.createTable('workflow_history', (table) => {
    history(table, 'workflow_id', 'workflows')
  })
  await database.schema.createTable('workflow_runs', (table) => {
    table.text('id').primary()
    parent(table, 'workflow_id', 'workflows', 'SET NULL')
    owner(table)
    table.jsonb('definition').notNullable()
    table.jsonb('used').notNullable().defaultTo(NOTHING_USED)
    table.text('state').notNullable()
    table.timestamp('created_at', { useTz: true }).notNullable()
    table.timestamp('finished_at', { useTz: true })
    table.index(['owner_id', 'created_at'])
  })
}

async function jobTables(database: Knex): Promise<void> {
  await database.schema.createTable('jobs', (table) => {
    table.text('id').primary()
    table.text('kind').notNullable()
    owner(table)
    table.text('pool').notNullable()
    table.integer('priority').notNullable()
    table.text('group_key').notNullable()
    parent(table, 'document_id', 'documents')
    parent(table, 'workflow_run_id', 'workflow_runs')
    table.text('state').notNullable()
    table.double('progress').notNullable().defaultTo(0)
    table.jsonb('payload').notNullable()
    table.jsonb('result')
    table.text('error')
    table.text('claimed_by')
    table.boolean('cancel_requested').notNullable().defaultTo(false)
    table.timestamp('created_at', { useTz: true }).notNullable()
    table.timestamp('started_at', { useTz: true })
    table.timestamp('finished_at', { useTz: true })
    table.index(['state', 'pool', 'priority', 'created_at'])
    table.index(['owner_id', 'state'])
    table.index(['group_key'])
    table.index(['document_id', 'kind', 'state'])
  })
  await database.schema.createTable('results', (table) => {
    table.text('id').primary()
    owner(table)
    table.text('kind').notNullable()
    table.text('key').notNullable()
    parent(table, 'document_id', 'documents')
    table.text('step_id')
    parent(table, 'workflow_run_id', 'workflow_runs')
    table.text('file_name').notNullable()
    table.text('media_type').notNullable()
    table.bigInteger('bytes').notNullable()
    table.timestamp('created_at', { useTz: true }).notNullable()
    table.index(['owner_id', 'created_at'])
    table.index(['key'])
    table.index(['document_id'])
  })
}

async function settingTables(database: Knex): Promise<void> {
  await database.schema.createTable('keybindings', (table) => {
    table
      .text('owner_id')
      .primary()
      .references('id')
      .inTable('user')
      .onDelete('CASCADE')
    table.jsonb('bindings').notNullable()
    table.timestamp('updated_at', { useTz: true }).notNullable()
  })
}

const TABLES_NEWEST_FIRST = [
  'keybindings',
  'results',
  'jobs',
  'workflow_runs',
  'workflow_history',
  'workflows',
  'history_entries',
  'document_operands',
  'documents',
  'sources',
  'verification',
  'account',
  'session',
  'user',
]

/** Every table, as the app first created them on Postgres. Earlier SQLite data is not carried over. */
export const schema: Migration = {
  name: '20261127000100-schema',
  async up(database) {
    for (const statement of AUTH_STATEMENTS) await database.raw(statement)
    await libraryTables(database)
    await workflowTables(database)
    await jobTables(database)
    await settingTables(database)
  },
  async down(database) {
    for (const table of TABLES_NEWEST_FIRST) {
      await database.schema.dropTableIfExists(table)
    }
  },
}
