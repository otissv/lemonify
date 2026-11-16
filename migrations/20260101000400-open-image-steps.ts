import { randomUUID } from 'node:crypto'

import type { Knex } from 'knex'

import type { Migration } from './index.ts'

type DocumentRow = { id: string; source_id: string; pipeline: string }

async function openedSourceIds(
  database: Knex,
  row: DocumentRow,
): Promise<string[]> {
  const operands: Array<{ source_id: string }> = await database(
    'document_operands',
  )
    .where({ document_id: row.id })
    .orderBy('source_id')
    .select('source_id')
  return [...new Set([row.source_id, ...operands.map((o) => o.source_id)])]
}

function buildOpenImageSteps(sourceIds: string[]): unknown[] {
  return sourceIds.map((sourceId) => ({
    id: randomUUID(),
    kind: 'source',
    sourceId,
    enabled: true,
  }))
}

/**
 * A document's image becomes the first Open image step of its pipeline, and
 * every image its steps use as a second image gets an Open image step after
 * it, so nothing is skipped. Step positions move, so the old undo history is
 * cleared.
 */
export const openImageSteps: Migration = {
  name: '20260101000400-open-image-steps',
  async up(database) {
    const rows: DocumentRow[] = await database('documents').select(
      'id',
      'source_id',
      'pipeline',
    )
    for (const row of rows) {
      const pipeline: { steps: unknown[] } = JSON.parse(row.pipeline)
      const opened = await openedSourceIds(database, row)
      await database('document_operands')
        .insert({ document_id: row.id, source_id: row.source_id })
        .onConflict(['document_id', 'source_id'])
        .ignore()
      await database('history_entries').where({ document_id: row.id }).delete()
      await database('documents')
        .where({ id: row.id })
        .update({
          pipeline: JSON.stringify({
            steps: [...buildOpenImageSteps(opened), ...pipeline.steps],
          }),
          history_cursor: 0,
          revision: database.raw('revision + 1'),
        })
    }
    await database.schema.alterTable('documents', (table) => {
      table.dropIndex(['source_id'])
    })
    await database.schema.alterTable('documents', (table) => {
      table.dropColumn('source_id')
    })
  },
  async down() {
    throw new Error(
      'The open-image-steps migration cannot be undone: documents no longer have a single source.',
    )
  },
}
