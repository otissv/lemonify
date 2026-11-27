import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import { loadConfig } from './config/config'
import { createApp } from './composition'
import { UnavailableError } from './errors'
import {
  createTestDatabase,
  databaseEnvironment,
} from './testing/test-database'

const run = promisify(execFile)
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn()
})

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lemonify-app-'))
  cleanup.push(async () => rmSync(dir, { recursive: true, force: true }))
  return dir
}

async function testEnvironment(): Promise<Record<string, string>> {
  const test = await createTestDatabase()
  cleanup.push(() => test.close())
  await test.database.destroy()
  return databaseEnvironment(test.config)
}

describe('createApp', () => {
  it('prepares the data directories and migrates the database', async () => {
    const dataDir = path.join(tempDir(), 'data')
    const app = await createApp(
      loadConfig({ ...(await testEnvironment()), LEMONIFY_DATA_DIR: dataDir }),
    )
    for (const sub of ['sources', 'results', 'render-cache']) {
      expect(existsSync(path.join(dataDir, sub))).toBe(true)
    }
    expect(await app.database.schema.hasTable('jobs')).toBe(true)
    await app.close()
  })

  it('stops with an unavailable error that says where it looked when the database cannot be reached', async () => {
    const environment = {
      ...(await testEnvironment()),
      POSTGRES_PORT: '1',
      LEMONIFY_DATA_DIR: path.join(tempDir(), 'data'),
    }
    const failure = createApp(loadConfig(environment))
    await expect(failure).rejects.toBeInstanceOf(UnavailableError)
    await expect(failure).rejects.toThrow(
      /127\.0\.0\.1:1.*docker compose up -d/,
    )
  })

  it('loads under plain Node with the CLI loader, not only under Vite', async () => {
    const dataDir = path.join(tempDir(), 'data')
    const root = path.resolve(__dirname, '../..')
    const { stdout } = await run(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        '--experimental-transform-types',
        '--import',
        path.join(root, 'scripts/images/register-alias.ts'),
        path.join(root, 'src/server/testing/load-composition.ts'),
      ],
      {
        env: {
          ...process.env,
          ...(await testEnvironment()),
          LEMONIFY_DATA_DIR: dataDir,
        },
        cwd: root,
      },
    )
    expect(JSON.parse(stdout).tables).toBeGreaterThanOrEqual(14)
  })
})
