import type { Knex } from 'knex'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MIGRATIONS } from '../../../migrations/index'
import { MEMORY_DATABASE, openDatabase } from './connection'
import { insertTestUser } from '../testing/test-database'

const OLD = MIGRATIONS.slice(0, 3)
const NEW = MIGRATIONS[3]
const NOW = '2026-01-01T00:00:00.000Z'

let open: Knex
beforeEach(() => {
  open = openDatabase(MEMORY_DATABASE)
})
afterEach(async () => {
  await open.destroy()
})

async function seed(): Promise<void> {
  for (const migration of OLD) await migration.up(open)
  await insertTestUser(open, 'ann')
  for (const id of ['base', 'mask']) {
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
  await open('documents').insert({
    id: 'doc',
    owner_id: 'ann',
    source_id: 'base',
    name: 'Doc',
    pipeline: JSON.stringify({
      steps: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          kind: 'sharp',
          op: 'boolean',
          options: { operand: 'mask', operator: 'and' },
          enabled: true,
        },
      ],
    }),
    revision: 3,
    history_cursor: 1,
    created_at: NOW,
    updated_at: NOW,
  })
  await open('document_operands').insert({
    document_id: 'doc',
    source_id: 'mask',
  })
  await open('history_entries').insert({
    document_id: 'doc',
    position: 0,
    patch: '{}',
    created_at: NOW,
  })
}

describe('open-image-steps migration', () => {
  it('turns the document image and its second images into Open image steps', async () => {
    await seed()
    await NEW?.up(open)

    const row = await open('documents').where({ id: 'doc' }).first()
    const steps: Array<Record<string, unknown>> = JSON.parse(row.pipeline).steps

    expect(steps.map(({ kind }) => kind)).toEqual(['source', 'source', 'sharp'])
    expect(steps.slice(0, 2).map(({ sourceId }) => sourceId)).toEqual([
      'base',
      'mask',
    ])
    expect(row.source_id).toBeUndefined()
    expect(row.revision).toBe(4)
    expect(row.history_cursor).toBe(0)
  })

  it('links the document image like any other used image and clears history', async () => {
    await seed()
    await NEW?.up(open)

    const links = await open('document_operands')
      .where({ document_id: 'doc' })
      .orderBy('source_id')
      .select('source_id')
    expect(links.map((link: { source_id: string }) => link.source_id)).toEqual([
      'base',
      'mask',
    ])
    expect(await open('history_entries').where({ document_id: 'doc' })).toEqual(
      [],
    )
  })
})
