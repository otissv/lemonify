// @vitest-environment node
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { databaseEnvironment } from '../config/config'
import { createTestDatabase } from '../testing/test-database'
import type { TestDatabase } from '../testing/test-database'

const run = promisify(execFile)
const ROOT = path.resolve(import.meta.dirname, '../../..')
/** More attempts than any of Better Auth's own rate limits allows in a window. */
const ATTEMPTS = 12
const UNAUTHORIZED = 401
const PROCESS_TIMEOUT = 60_000

let test: TestDatabase

beforeEach(async () => {
  test = await createTestDatabase()
})

afterEach(async () => {
  await test.close()
})

describe('Better Auth in production', () => {
  it(
    'leaves rate limiting to the app’s own guard, which sees each visitor’s address',
    async () => {
      const { stdout } = await run(
        process.execPath,
        [
          '--disable-warning=ExperimentalWarning',
          '--experimental-transform-types',
          '--import',
          path.join(ROOT, 'scripts/images/register-alias.ts'),
          path.join(ROOT, 'src/server/testing/auth-rate-limit-probe.ts'),
          String(ATTEMPTS),
        ],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            ...databaseEnvironment(test.config),
            NODE_ENV: 'production',
          },
          timeout: PROCESS_TIMEOUT,
        },
      )
      const { statuses }: { statuses: number[] } = JSON.parse(stdout)
      expect(statuses).toEqual(
        Array.from({ length: ATTEMPTS }, () => UNAUTHORIZED),
      )
    },
    PROCESS_TIMEOUT,
  )
})
