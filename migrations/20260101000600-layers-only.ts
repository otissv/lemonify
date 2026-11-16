import type { Knex } from 'knex'

import type { Migration } from './index.ts'

type Step = Record<string, unknown>
type DocumentRow = { id: string; pipeline: string }

function layerOfImage(step: Step): Step {
  return {
    ...step,
    kind: 'layer',
    opacity: 100,
    blend: 'normal',
    fit: 'inside',
    scale: 100,
    rotation: 0,
    anchor: 'centre',
    x: 0,
    y: 0,
  }
}

async function migrateDocument(
  database: Knex,
  row: DocumentRow,
): Promise<void> {
  const pipeline: { steps: Step[] } = JSON.parse(row.pipeline)
  if (!pipeline.steps.some((step) => step.kind === 'source')) return
  const steps = pipeline.steps.map((step) =>
    step.kind === 'source' ? layerOfImage(step) : step,
  )
  await database('history_entries').where({ document_id: row.id }).delete()
  await database('documents')
    .where({ id: row.id })
    .update({
      pipeline: JSON.stringify({ steps }),
      history_cursor: 0,
      revision: database.raw('revision + 1'),
    })
}

/**
 * There is no separate image step any more: every image is a layer, and the
 * first layer that is switched on sets the canvas. The old image step becomes
 * a layer in the same place with the default settings. Step kinds change, so
 * the undo history of a document that had one is cleared.
 */
export const layersOnly: Migration = {
  name: '20260101000600-layers-only',
  async up(database) {
    const rows: DocumentRow[] = await database('documents').select(
      'id',
      'pipeline',
    )
    for (const row of rows) await migrateDocument(database, row)
  },
  async down() {
    throw new Error(
      'The layers-only migration cannot be undone: documents no longer have a separate image step.',
    )
  },
}
