import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import { databaseEnvironment, loadConfig } from './config/config'
import { WorkerPool } from '@/features/ai/ai-tools'

import { AppRole, createApp } from './composition'
import type { App } from './composition'
import { UnavailableError } from './errors'
import { MemoryLogger } from './http/logger'
import { JobKind, JobState } from './jobs/job-types'
import { FakeImageEngine, FakeWorkerProcess } from './testing/fakes'
import { createTestDatabase, insertTestUser } from './testing/test-database'

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

describe('the app of the web server', () => {
  const ANN = { userId: 'ann', name: 'Ann' }
  const QUIET_MS = 1500

  async function webServerApp(): Promise<{
    app: App
    workers: FakeWorkerProcess[]
  }> {
    const workers: FakeWorkerProcess[] = []
    const app = await createApp(
      loadConfig({
        ...(await testEnvironment()),
        LEMONIFY_DATA_DIR: path.join(tempDir(), 'data'),
        LEMONIFY_CPU_WORKERS: '2',
        LEMONIFY_GPU_WORKERS: '1',
      }),
      {
        role: AppRole.WebServer,
        imageEngine: new FakeImageEngine(),
        logger: new MemoryLogger(),
        startWorker: (pool) => {
          const worker = new FakeWorkerProcess(pool, true)
          workers.push(worker)
          return worker
        },
      },
    )
    cleanup.unshift(() => app.close())
    await insertTestUser(app.database, ANN.userId, ANN.name)
    return { app, workers }
  }

  function preview(pool: WorkerPool) {
    return {
      kind: JobKind.Preview,
      payload: { kind: JobKind.Preview, documentId: 'doc', revision: 0 },
      pool,
      groupKey: 'doc',
    } as const
  }

  it('runs no job itself: it starts the CPU worker processes, and a job queued on the website wakes them', async () => {
    const { app, workers } = await webServerApp()
    await app.startBackground()
    expect(workers.map((worker) => worker.pool)).toEqual([
      WorkerPool.Cpu,
      WorkerPool.Cpu,
    ])
    for (const worker of workers) worker.ready()

    const [queued] = await app.jobs.enqueue(ANN, [preview(WorkerPool.Cpu)])
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS))

    for (const worker of workers)
      expect(worker.sent).toEqual([{ type: 'wake' }])
    expect((await app.jobs.get(ANN, queued?.id ?? '')).state).toBe(
      JobState.Waiting,
    )
  })

  it('starts the GPU worker when an AI job is queued on the website', async () => {
    const { app, workers } = await webServerApp()
    await app.startBackground()

    await app.jobs.enqueue(ANN, [preview(WorkerPool.Gpu)])

    expect(
      workers.filter((worker) => worker.pool === WorkerPool.Gpu),
    ).toHaveLength(1)
  })

  it('stops the worker processes when it closes', async () => {
    const { app, workers } = await webServerApp()
    await app.startBackground()

    await app.close()

    expect(
      workers.every((worker) => worker.stopRequested && worker.exited),
    ).toBe(true)
  })
})
