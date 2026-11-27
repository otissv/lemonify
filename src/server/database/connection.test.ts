import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestDatabase } from '../testing/test-database'
import type { TestDatabase } from '../testing/test-database'
import { LOCK_TIMEOUT_MS, STATEMENT_TIMEOUT_MS } from './connection'

let test: TestDatabase

beforeAll(async () => {
  test = await createTestDatabase()
})

afterAll(async () => {
  await test.close()
})

async function value(sql: string): Promise<unknown> {
  const result = await test.database.raw(sql)
  return result.rows[0].value
}

describe('openDatabase', () => {
  it('sets a lock timeout and a statement timeout on every connection', async () => {
    expect(await value("select current_setting('lock_timeout') as value")).toBe(
      `${LOCK_TIMEOUT_MS / 1000}s`,
    )
    expect(
      await value("select current_setting('statement_timeout') as value"),
    ).toBe(`${STATEMENT_TIMEOUT_MS / 1000}s`)
  })

  it('reads a time as a UTC ISO string', async () => {
    expect(
      await value("select '2026-03-04 05:06:07.089+02'::timestamptz as value"),
    ).toBe('2026-03-04T03:06:07.089Z')
  })

  it('reads a bigint as a number, and refuses one too large to be exact', async () => {
    expect(await value('select 9007199254740991::bigint as value')).toBe(
      Number.MAX_SAFE_INTEGER,
    )
    await expect(
      value('select 9007199254740993::bigint as value'),
    ).rejects.toThrow(/too large/)
  })

  it('reads JSON as its text, for the DAO to parse and check', async () => {
    expect(await value(`select '{"a": 1}'::jsonb as value`)).toBe('{"a": 1}')
  })

  it('ends a wait for a lock with an error instead of waiting for ever', async () => {
    await test.database.schema.createTable('locked', (table) => {
      table.integer('id').primary()
    })
    await test.database('locked').insert({ id: 1 })
    await test.database.transaction(async (holder) => {
      await holder('locked').where({ id: 1 }).forUpdate()
      const started = Date.now()
      await expect(
        test.database.transaction(async (waiter) => {
          await waiter.raw("set local lock_timeout = '200ms'")
          await waiter('locked').where({ id: 1 }).forUpdate()
        }),
      ).rejects.toThrow(/lock timeout/)
      expect(Date.now() - started).toBeLessThan(LOCK_TIMEOUT_MS)
    })
  })
})
