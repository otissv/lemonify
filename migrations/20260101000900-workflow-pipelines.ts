import type { Knex } from 'knex'

import type { Migration } from './index.ts'

/**
 * A workflow is a pipeline with a canvas, like a document, instead of a graph
 * of nodes. Its column is renamed to say so, and a run records which canvas it
 * drew on. Rows written as graphs are not converted: they fail to read, and
 * must be deleted.
 */
export const workflowPipelines: Migration = {
  name: '20260101000900-workflow-pipelines',
  async up(database: Knex) {
    await database.schema.alterTable('workflows', (table) => {
      table.renameColumn('graph', 'definition')
    })
    await database.schema.alterTable('workflow_runs', (table) => {
      table.renameColumn('graph', 'definition')
      table.text('canvas_mode').notNullable().defaultTo('workflow')
    })
  },
  async down(database: Knex) {
    await database.schema.alterTable('workflow_runs', (table) => {
      table.dropColumn('canvas_mode')
      table.renameColumn('definition', 'graph')
    })
    await database.schema.alterTable('workflows', (table) => {
      table.renameColumn('definition', 'graph')
    })
  },
}
