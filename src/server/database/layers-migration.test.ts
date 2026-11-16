import type { Knex } from 'knex'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MIGRATIONS } from '../../../migrations/index'
import { MEMORY_DATABASE, openDatabase } from './connection'
import { insertTestUser } from '../testing/test-database'

const OLD = MIGRATIONS.slice(0, 4)
const NEW = MIGRATIONS[4]
const NOW = '2026-01-01T00:00:00.000Z'

type Step = Record<string, unknown>

let open: Knex
beforeEach(async () => {
  open = openDatabase(MEMORY_DATABASE)
  for (const migration of OLD) await migration.up(open)
  await insertTestUser(open, 'ann')
  for (const id of ['base', 'mask', 'logo', 'badge']) {
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

const open1 = (sourceId: string): Step => ({
  id: `open-${sourceId}`,
  kind: 'source',
  sourceId,
  enabled: true,
})

const sharpStep = (id: string, op: string, options: Step): Step => ({
  id,
  kind: 'sharp',
  op,
  options,
  enabled: true,
})

async function seed(steps: Step[]): Promise<void> {
  await open('documents').insert({
    id: 'doc',
    owner_id: 'ann',
    name: 'Doc',
    pipeline: JSON.stringify({ steps }),
    revision: 3,
    history_cursor: 1,
    created_at: NOW,
    updated_at: NOW,
  })
  await open('history_entries').insert({
    document_id: 'doc',
    position: 0,
    patch: '{}',
    created_at: NOW,
  })
}

async function migrated(): Promise<Step[]> {
  await NEW?.up(open)
  const row = await open('documents').where({ id: 'doc' }).first()
  return JSON.parse(row.pipeline).steps
}

describe('layers migration', () => {
  it('turns an extra image step that nothing uses into a layer', async () => {
    await seed([open1('base'), open1('logo'), sharpStep('flip', 'flip', {})])

    const steps = await migrated()

    expect(steps.map(({ kind }) => kind)).toEqual(['source', 'layer', 'sharp'])
    expect(steps[1]).toMatchObject({
      id: 'open-logo',
      sourceId: 'logo',
      enabled: true,
      opacity: 100,
      blend: 'normal',
      fit: 'inside',
      scale: 100,
      rotation: 0,
      anchor: 'centre',
      x: 0,
      y: 0,
    })
  })

  it('drops an extra image step that only gave a boolean or join step its image', async () => {
    await seed([
      open1('base'),
      open1('mask'),
      open1('logo'),
      sharpStep('and', 'boolean', { operand: 'mask', operator: 'and' }),
      sharpStep('join', 'joinChannel', { images: ['logo'] }),
    ])

    const steps = await migrated()

    expect(steps.map(({ id }) => id)).toEqual(['open-base', 'and', 'join'])
  })

  it('turns each image of a composite step into a layer, carrying its blend and place over', async () => {
    await seed([
      open1('base'),
      sharpStep('stack', 'composite', {
        images: [
          { input: 'logo', blend: 'multiply', gravity: 'south' },
          { input: 'badge', blend: 'over', top: 10, left: 20 },
          { input: 'mask', blend: 'xor', tile: true },
        ],
      }),
    ])

    const steps = await migrated()

    expect(steps.map(({ kind }) => kind)).toEqual([
      'source',
      'layer',
      'layer',
      'layer',
    ])
    expect(steps[1]).toMatchObject({
      id: 'stack',
      sourceId: 'logo',
      blend: 'multiply',
      anchor: 'south',
      fit: 'original',
      x: 0,
      y: 0,
    })
    expect(steps[2]).toMatchObject({
      sourceId: 'badge',
      blend: 'normal',
      anchor: 'northwest',
      x: 20,
      y: 10,
    })
    expect(steps[3]).toMatchObject({ sourceId: 'mask', blend: 'normal' })
    expect(new Set(steps.map(({ id }) => id)).size).toBe(4)
  })

  it('keeps a switched-off composite switched off', async () => {
    await seed([
      open1('base'),
      {
        ...sharpStep('stack', 'composite', { images: [{ input: 'logo' }] }),
        enabled: false,
      },
    ])

    const steps = await migrated()

    expect(steps[1]).toMatchObject({ kind: 'layer', enabled: false })
  })

  it('puts the document’s image first', async () => {
    await seed([sharpStep('flip', 'flip', {}), open1('base')])

    const steps = await migrated()

    expect(steps.map(({ id }) => id)).toEqual(['open-base', 'flip'])
  })

  it('links the images the new pipeline uses, clears the history and moves the revision on', async () => {
    await seed([
      open1('base'),
      open1('mask'),
      open1('logo'),
      sharpStep('and', 'boolean', { operand: 'mask', operator: 'and' }),
    ])
    await open('document_operands').insert([
      { document_id: 'doc', source_id: 'base' },
      { document_id: 'doc', source_id: 'mask' },
      { document_id: 'doc', source_id: 'logo' },
    ])

    await NEW?.up(open)

    const linked: Array<{ source_id: string }> = await open('document_operands')
      .where({ document_id: 'doc' })
      .orderBy('source_id')
      .select('source_id')
    expect(linked.map(({ source_id }) => source_id)).toEqual([
      'base',
      'logo',
      'mask',
    ])
    const row = await open('documents').where({ id: 'doc' }).first()
    expect(row.revision).toBe(4)
    expect(row.history_cursor).toBe(0)
    expect(await open('history_entries').where({ document_id: 'doc' })).toEqual(
      [],
    )
  })

  it('refuses to migrate a document that has no image, naming it', async () => {
    await seed([sharpStep('flip', 'flip', {})])

    await expect(NEW?.up(open)).rejects.toThrow(/doc/)
  })

  it('cannot be undone', async () => {
    await expect(NEW?.down(open)).rejects.toThrow(/cannot be undone/)
  })
})
