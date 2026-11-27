import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import pg from 'pg'
import sharp from 'sharp'
import { z } from 'zod'

import { E2E_DATABASE } from '../playwright.config.ts'
import { connectionSettings } from '../src/server/database/connection.ts'
import { RunResult, SourceResult, WorkflowResult, cliResult } from './cli.ts'
import { E2E_STORE, storeDatabase } from './database.ts'
import { RUN_DIR, SCRATCH_ACCOUNTS } from './global-setup.ts'
import { uniqueName } from './workflow-page.ts'

/**
 * The web server keeps answering while it waits for the database and while
 * images are being processed (decision 5, database waits; decision 1, worker
 * processes): a request that needs neither the locked row nor the busy workers
 * is answered within RESPONSE_BUDGET_MS.
 */
const ACCOUNT = SCRATCH_ACCOUNTS.responsive
const USER = ['--user', ACCOUNT.user.name]
const RESPONSE_BUDGET_MS = 100
/** The server stalls now and then, not on every request, so each test takes the slowest of several. */
const SAMPLES = 10
const WAIT_TIMEOUT = 30_000
/** Large enough that each image keeps a worker busy for seconds. */
const LARGE_SIDE = 4000
const LARGE_IMAGES = 8
const SLOW_STEPS = '[{"op":"blur","options":{"sigma":40}}]'

const CountSchema = z.object({ count: z.number() })
const IdSchema = z.object({ id: z.string() })
const DocumentResult = z.object({ document: IdSchema })

test.use({ storageState: ACCOUNT.authFile })
test.describe.configure({ mode: 'serial', timeout: 180_000 })

let database: pg.Client
let sourceId = ''

async function count(sql: string, values: unknown[] = []): Promise<number> {
  const { rows } = await database.query(sql, values)
  return CountSchema.parse(rows[0]).count
}

/** How long one request for the account's image takes, in milliseconds; it must succeed. */
async function timedSourceRequest(request: APIRequestContext): Promise<number> {
  const started = performance.now()
  const response = await request.get(`/api/sources/${sourceId}`)
  await response.body()
  const elapsed = performance.now() - started
  expect(response.status()).toBe(200)
  return elapsed
}

/** The slowest of SAMPLES requests made one after another. */
async function slowestSourceRequest(
  request: APIRequestContext,
): Promise<number> {
  let slowest = 0
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    slowest = Math.max(slowest, await timedSourceRequest(request))
  }
  return slowest
}

test.beforeAll(async () => {
  database = new pg.Client(connectionSettings(storeDatabase(E2E_DATABASE)))
  await database.connect()
  const { rows } = await database.query(
    'select s.id from sources s join "user" u on u.id = s.owner_id where u.email = $1 order by s.created_at limit 1',
    [ACCOUNT.user.email],
  )
  sourceId = IdSchema.parse(rows[0]).id
})

test.afterAll(async () => {
  await database.end()
})

test('answers a request while another of its requests waits for a locked document', async ({
  page,
}, testInfo) => {
  // A new document has no preview yet, so opening it queues one.
  const { document } = await cliResult(
    E2E_STORE,
    [
      'document',
      'create',
      sourceId,
      '--name',
      uniqueName(testInfo, 'Locked'),
      ...USER,
    ],
    DocumentResult,
  )
  await timedSourceRequest(page.request)
  await database.query('begin')
  try {
    await database.query('select id from documents where id = $1 for update', [
      document.id,
    ])
    // Opening the document queues its preview, which waits for the row.
    await page.goto(`/documents/${document.id}`)
    await expect
      .poll(
        () =>
          count(
            'select count(*)::int as count from pg_stat_activity where pg_backend_pid() = any(pg_blocking_pids(pid))',
          ),
        { timeout: WAIT_TIMEOUT, intervals: [20] },
      )
      .toBeGreaterThan(0)
    expect(await slowestSourceRequest(page.request)).toBeLessThan(
      RESPONSE_BUDGET_MS,
    )
  } finally {
    await database.query('commit')
  }
  await expect(
    page.locator('[data-slot="canvas"] img[src*="/renders/preview/"]'),
  ).toBeVisible({ timeout: WAIT_TIMEOUT })
})

async function largeImages(folder: string): Promise<string[]> {
  const ids: string[] = []
  for (let index = 0; index < LARGE_IMAGES; index += 1) {
    const file = path.join(folder, `large-${index}.png`)
    await sharp({
      create: {
        width: LARGE_SIDE,
        height: LARGE_SIDE,
        channels: 3,
        background: { r: index * 30, g: 90, b: 160 },
      },
    })
      .png()
      .toFile(file)
    const added = await cliResult(
      E2E_STORE,
      ['source', 'add', file, ...USER],
      SourceResult,
    )
    ids.push(added.source.id)
  }
  return ids
}

test('answers a request and reads a file while the CPU workers are busy with long renders', async ({
  page,
}, testInfo) => {
  test.fail(
    true,
    'The web server runs the jobs itself until the worker pool takes them over (docs/job-workers-todo.md, section 5).',
  )
  const folder = path.join(
    RUN_DIR,
    'responsiveness',
    `${testInfo.workerIndex}-${Date.now()}`,
  )
  mkdirSync(folder, { recursive: true })
  let runId = ''
  try {
    const sources = await largeImages(folder)
    const { workflow } = await cliResult(
      E2E_STORE,
      [
        'workflow',
        'create',
        uniqueName(testInfo, 'Slow'),
        '--sources',
        sources.join(','),
        '--steps',
        SLOW_STEPS,
        ...USER,
      ],
      WorkflowResult,
    )
    await timedSourceRequest(page.request)
    runId = (
      await cliResult(
        E2E_STORE,
        ['workflow', 'run', workflow.id, ...USER],
        RunResult,
      )
    ).run.id
    await expect
      .poll(
        () =>
          count(
            "select count(*)::int as count from jobs where workflow_run_id = $1 and state = 'running'",
            [runId],
          ),
        { timeout: WAIT_TIMEOUT, intervals: [50] },
      )
      .toBeGreaterThan(1)
    expect(await slowestSourceRequest(page.request)).toBeLessThan(
      RESPONSE_BUDGET_MS,
    )
  } finally {
    if (runId !== '') {
      await cliResult(
        E2E_STORE,
        ['workflow', 'cancel', runId, ...USER],
        RunResult,
      )
    }
    rmSync(folder, { recursive: true, force: true })
  }
})
