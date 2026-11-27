import { afterEach, describe, expect, it } from 'vitest'
import { inject } from 'vitest'

import { loadConfig } from '../config/config'
import { readEnvironment } from '../config/environment'
import { openDatabase } from './connection'
import { createDatabase, databasesStartingWith, dropDatabase } from './admin'

const server = loadConfig(readEnvironment()).database
const prefix = `lemonify_test_${inject('testRun')}_admin`

afterEach(async () => {
  for (const name of await databasesStartingWith(server, prefix))
    await dropDatabase(server, name)
})

describe('the database admin helpers', () => {
  it('create an empty database, find it by its prefix and drop it', async () => {
    await createDatabase(server, `${prefix}_one`)
    expect(await databasesStartingWith(server, prefix)).toEqual([
      `${prefix}_one`,
    ])
    await dropDatabase(server, `${prefix}_one`)
    expect(await databasesStartingWith(server, prefix)).toEqual([])
  })

  it('copy a template, tables and rows', async () => {
    await createDatabase(server, `${prefix}_template`)
    const template = openDatabase({ ...server, database: `${prefix}_template` })
    await template.schema.createTable('kept', (table) => {
      table.integer('id').primary()
    })
    await template('kept').insert({ id: 7 })
    await template.destroy()

    await createDatabase(server, `${prefix}_copy`, `${prefix}_template`)
    const copy = openDatabase({ ...server, database: `${prefix}_copy` })
    expect(await copy('kept').select('id')).toEqual([{ id: 7 }])
    await copy.destroy()
  })

  it('drop a database that has open connections, and one that is not there', async () => {
    await createDatabase(server, `${prefix}_busy`)
    const busy = openDatabase({ ...server, database: `${prefix}_busy` })
    await busy.raw('select 1')
    await dropDatabase(server, `${prefix}_busy`)
    await busy.destroy()
    await expect(
      dropDatabase(server, `${prefix}_busy`),
    ).resolves.toBeUndefined()
  })

  it('treat a name as one identifier, never as SQL', async () => {
    const odd = `${prefix}_"; drop database postgres; --`
    await createDatabase(server, odd)
    expect(await databasesStartingWith(server, prefix)).toEqual([odd])
  })
})
