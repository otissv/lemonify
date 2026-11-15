import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import { loadConfig } from './config/config'
import { createApp } from './composition'

const run = promisify(execFile)
const cleanup: string[] = []
afterEach(() => {
  for (const dir of cleanup.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lemonify-app-'))
  cleanup.push(dir)
  return dir
}

describe('createApp', () => {
  it('prepares the data directories and migrates the database', async () => {
    const dataDir = path.join(tempDir(), 'data')
    const app = await createApp(loadConfig({ LEMONIFY_DATA_DIR: dataDir }))
    for (const sub of ['sources', 'results', 'render-cache']) {
      expect(existsSync(path.join(dataDir, sub))).toBe(true)
    }
    const rows = await app.database('sqlite_master').where({ name: 'jobs' })
    expect(rows).toHaveLength(1)
    await app.close()
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
      { env: { ...process.env, LEMONIFY_DATA_DIR: dataDir }, cwd: root },
    )
    expect(JSON.parse(stdout).tables).toBeGreaterThanOrEqual(12)
  })
})
