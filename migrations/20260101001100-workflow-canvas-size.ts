import type { Knex } from 'knex'

import type { Migration } from './index.ts'

const FIXED = 'fixed'
const MATCH_INPUT = 'match-input'
const OLD_FIXED = 'workflow'
const OLD_MATCH = 'first-image'
const DIAGRAM_JOBS = ['workflow-thumbnail', 'workflow-preview']

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The JSON in a column, or undefined when it cannot be read; such a row is left for the data access layer to refuse. */
function parsed(text: string): JsonObject | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return isObject(value) ? value : undefined
  } catch {
    return undefined
  }
}

function withSize(definition: unknown, size: string): unknown {
  return isObject(definition) ? { ...definition, canvasSize: size } : definition
}

function withoutSize(definition: unknown): unknown {
  if (!isObject(definition)) return definition
  const { canvasSize: _dropped, ...rest } = definition
  return rest
}

/** A history patch with `change` applied to the definition of each `replace` in it. */
function patched(
  patch: JsonObject,
  change: (definition: unknown) => unknown,
): JsonObject {
  const side = (value: unknown): unknown =>
    isObject(value) && value.type === 'replace'
      ? { ...value, definition: change(value.definition) }
      : value
  return {
    ...patch,
    forward: side(patch.forward),
    inverse: side(patch.inverse),
  }
}

async function rewrite(
  database: Knex,
  table: string,
  column: string,
  key: ReadonlyArray<string>,
  change: (value: JsonObject, row: Record<string, unknown>) => JsonObject,
  where?: (query: Knex.QueryBuilder) => void,
): Promise<void> {
  const query = database(table).select('*')
  if (where !== undefined) where(query)
  const rows: Array<Record<string, unknown>> = await query
  for (const row of rows) {
    const value = parsed(String(row[column]))
    if (value === undefined) continue
    const match = Object.fromEntries(key.map((name) => [name, row[name]]))
    await database(table)
      .where(match)
      .update({ [column]: JSON.stringify(change(value, row)) })
  }
}

/**
 * Whether a workflow's canvas has its own size or takes each input image's is
 * saved with the workflow (`canvasSize`), instead of being chosen for each
 * run. Saved workflows keep the canvas they were drawn on, a fixed one; each
 * run keeps the choice it was started with, now in its copy of the workflow;
 * and queued diagram pictures stop carrying the choice, since they read it
 * from the workflow.
 */
export const workflowCanvasSize: Migration = {
  name: '20260101001100-workflow-canvas-size',
  async up(database: Knex) {
    await rewrite(database, 'workflows', 'definition', ['id'], (value) => ({
      ...value,
      canvasSize: FIXED,
    }))
    await rewrite(
      database,
      'workflow_history',
      'patch',
      ['workflow_id', 'position'],
      (patch) => patched(patch, (definition) => withSize(definition, FIXED)),
    )
    await rewrite(
      database,
      'workflow_runs',
      'definition',
      ['id'],
      (value, row) => ({
        ...value,
        canvasSize: row.canvas_mode === OLD_MATCH ? MATCH_INPUT : FIXED,
      }),
    )
    await database.schema.alterTable('workflow_runs', (table) => {
      table.dropColumn('canvas_mode')
    })
    await rewrite(
      database,
      'jobs',
      'payload',
      ['id'],
      (payload) => {
        const { canvasMode: _dropped, ...rest } = payload
        return rest
      },
      (query) => {
        query.whereIn('kind', DIAGRAM_JOBS)
      },
    )
  },
  async down(database: Knex) {
    await rewrite(
      database,
      'jobs',
      'payload',
      ['id'],
      (payload) => ({ ...payload, canvasMode: OLD_FIXED }),
      (query) => {
        query.whereIn('kind', DIAGRAM_JOBS)
      },
    )
    await database.schema.alterTable('workflow_runs', (table) => {
      table.text('canvas_mode').notNullable().defaultTo(OLD_FIXED)
    })
    const runs: Array<{ id: string; definition: string }> = await database(
      'workflow_runs',
    ).select('id', 'definition')
    for (const run of runs) {
      const value = parsed(run.definition)
      if (value === undefined) continue
      await database('workflow_runs')
        .where({ id: run.id })
        .update({
          canvas_mode: value.canvasSize === MATCH_INPUT ? OLD_MATCH : OLD_FIXED,
          definition: JSON.stringify(withoutSize(value)),
        })
    }
    await rewrite(
      database,
      'workflow_history',
      'patch',
      ['workflow_id', 'position'],
      (patch) => patched(patch, withoutSize),
    )
    await rewrite(database, 'workflows', 'definition', ['id'], (value) => {
      const { canvasSize: _dropped, ...rest } = value
      return rest
    })
  },
}
