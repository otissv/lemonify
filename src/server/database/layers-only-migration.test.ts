import type { Knex } from 'knex'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MIGRATIONS } from '../../../migrations/index'
import { MEMORY_DATABASE, openDatabase } from './connection'
import { insertTestUser } from '../testing/test-database'

const OLD = MIGRATIONS.slice(0, 5)
const NEW = MIGRATIONS[5]
const NOW = '2026-01-01T00:00:00.000Z'

type Step = Record<string, unknown>

let open: Knex
beforeEach(async () => {
  open = openDatabase(MEMORY_DATABASE)
  for (const migration of OLD) await migration.up(open)
  await insertTestUser(open, 'ann')
  for (const id of ['base', 'logo']) {
    await open('sources').insert({
      id,
      owner_id: 'ann',
      content_hash: id,
      file_name: `${id}.png`,
      media_type: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
      created_at: NOW,
    })
  }
})
afterEach(async () => {
  await open.destroy()
})

async function seed(id: string, steps: Step[]): Promise<void> {
  await open('documents').insert({
    id,
    owner_id: 'ann',
    name: id,
    pipeline: JSON.stringify({ steps }),
    revision: 3,
    history_cursor: 1,
    created_at: NOW,
    updated_at: NOW,
  })
  await open('history_entries').insert({
    document_id: id,
    position: 0,
    patch: '{}',
    created_at: NOW,
  })
}

async function stepsOf(id: string): Promise<Step[]> {
  const row = await open('documents').where({ id }).first()
  return JSON.parse(row.pipeline).steps
}

describe('layers-only migration', () => {
  it('turns the document’s image step into a layer with the default settings, keeping its id, name and switch', async () => {
    await seed('doc', [
      {
        id: 'image',
        kind: 'source',
        sourceId: 'base',
        enabled: true,
        name: 'Hero',
      },
      { id: 'flip', kind: 'sharp', op: 'flip', options: {}, enabled: true },
      {
        id: 'logo',
        kind: 'layer',
        sourceId: 'logo',
        enabled: false,
        opacity: 40,
      },
    ])

    await NEW?.up(open)

    const steps = await stepsOf('doc')
    expect(steps.map(({ kind }) => kind)).toEqual(['layer', 'sharp', 'layer'])
    expect(steps[0]).toMatchObject({
      id: 'image',
      sourceId: 'base',
      enabled: true,
      name: 'Hero',
      opacity: 100,
      blend: 'normal',
      fit: 'inside',
      scale: 100,
      rotation: 0,
      anchor: 'centre',
      x: 0,
      y: 0,
    })
    expect(steps[2]).toMatchObject({ id: 'logo', enabled: false, opacity: 40 })
  })

  it('moves the revision on and clears the history, since the steps changed', async () => {
    await seed('doc', [
      { id: 'image', kind: 'source', sourceId: 'base', enabled: true },
    ])

    await NEW?.up(open)

    const row = await open('documents').where({ id: 'doc' }).first()
    expect(row.revision).toBe(4)
    expect(row.history_cursor).toBe(0)
    expect(await open('history_entries').where({ document_id: 'doc' })).toEqual(
      [],
    )
  })

  it('leaves a document that has no image step alone', async () => {
    await seed('doc', [
      { id: 'logo', kind: 'layer', sourceId: 'logo', enabled: true },
    ])

    await NEW?.up(open)

    const row = await open('documents').where({ id: 'doc' }).first()
    expect(row.revision).toBe(3)
    expect(row.history_cursor).toBe(1)
  })

  it('cannot be undone', async () => {
    await expect(NEW?.down(open)).rejects.toThrow(/cannot be undone/)
  })
})
