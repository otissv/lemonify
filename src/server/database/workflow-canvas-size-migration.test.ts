import type { Knex } from 'knex'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MIGRATIONS } from '../../../migrations/index'
import { insertTestUser } from '../testing/test-database'
import { MEMORY_DATABASE, openDatabase } from './connection'

const INDEX = MIGRATIONS.findIndex(
  ({ name }) => name === '20260101001100-workflow-canvas-size',
)
const OLD = MIGRATIONS.slice(0, INDEX)
const NEW = MIGRATIONS[INDEX]
const NOW = '2026-01-01T00:00:00.000Z'
const PIPELINE = {
  canvas: { width: 10, height: 10, background: 'transparent' },
  steps: [],
}

function definition(): Record<string, unknown> {
  return { pipeline: PIPELINE, inputs: [], output: { widths: [] } }
}

let open: Knex
beforeEach(async () => {
  open = openDatabase(MEMORY_DATABASE)
  for (const migration of OLD) await migration.up(open)
  await insertTestUser(open, 'ann')
  await open('workflows').insert({
    id: 'w1',
    owner_id: 'ann',
    name: 'One',
    definition: JSON.stringify(definition()),
    revision: 0,
    history_cursor: 1,
    created_at: NOW,
    updated_at: NOW,
  })
  await open('workflow_history').insert({
    workflow_id: 'w1',
    position: 0,
    patch: JSON.stringify({
      forward: { type: 'replace', definition: definition() },
      inverse: { type: 'set-inputs', sourceIds: [] },
    }),
    created_at: NOW,
  })
  for (const [id, mode] of [
    ['run-fixed', 'workflow'],
    ['run-match', 'first-image'],
  ]) {
    await open('workflow_runs').insert({
      id,
      workflow_id: 'w1',
      owner_id: 'ann',
      definition: JSON.stringify(definition()),
      canvas_mode: mode,
      state: 'done',
      created_at: NOW,
      finished_at: NOW,
    })
  }
  await open('jobs').insert({
    id: 'job-1',
    kind: 'workflow-preview',
    owner_id: 'ann',
    pool: 'cpu',
    priority: 0,
    group_key: 'w1',
    workflow_run_id: 'run-fixed',
    state: 'waiting',
    payload: JSON.stringify({
      kind: 'workflow-preview',
      workflowId: 'w1',
      revision: 0,
      canvasMode: 'workflow',
      nodeId: 'output',
    }),
    created_at: NOW,
  })
})
afterEach(async () => {
  await open.destroy()
})

async function json(table: string, column: string, where: object) {
  const row = await open(table).where(where).first()
  return JSON.parse(row[column])
}

describe('the workflow canvas size migration', () => {
  it('keeps every saved workflow on the canvas size it had', async () => {
    await NEW?.up(open)

    expect(await json('workflows', 'definition', { id: 'w1' })).toMatchObject({
      canvasSize: 'fixed',
    })
    const patch = await json('workflow_history', 'patch', { workflow_id: 'w1' })
    expect(patch.forward.definition.canvasSize).toBe('fixed')
    expect(patch.inverse).toEqual({ type: 'set-inputs', sourceIds: [] })
  })

  it('moves the canvas a run drew on into the copy of the workflow it keeps', async () => {
    await NEW?.up(open)

    expect(
      await json('workflow_runs', 'definition', { id: 'run-fixed' }),
    ).toMatchObject({ canvasSize: 'fixed' })
    expect(
      await json('workflow_runs', 'definition', { id: 'run-match' }),
    ).toMatchObject({ canvasSize: 'match-input' })
    expect(await open.schema.hasColumn('workflow_runs', 'canvas_mode')).toBe(
      false,
    )
    expect(await open('jobs').where({ id: 'job-1' }).first()).toBeDefined()
  })

  it('takes the canvas out of queued diagram pictures, which now read it from the workflow', async () => {
    await NEW?.up(open)

    expect(await json('jobs', 'payload', { id: 'job-1' })).toEqual({
      kind: 'workflow-preview',
      workflowId: 'w1',
      revision: 0,
      nodeId: 'output',
    })
  })

  it('can be undone', async () => {
    await NEW?.up(open)

    await NEW?.down(open)

    expect(await json('workflows', 'definition', { id: 'w1' })).toEqual(
      definition(),
    )
    const runs: Array<{ id: string; canvas_mode: string }> = await open(
      'workflow_runs',
    ).select('id', 'canvas_mode')
    expect(Object.fromEntries(runs.map((r) => [r.id, r.canvas_mode]))).toEqual({
      'run-fixed': 'workflow',
      'run-match': 'first-image',
    })
    expect(await json('jobs', 'payload', { id: 'job-1' })).toMatchObject({
      canvasMode: 'workflow',
    })
  })
})
