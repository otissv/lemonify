// @vitest-environment node
import { existsSync } from 'node:fs'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkerPool } from '../../src/features/ai/ai-tools.ts'
import { startChannelServer } from '../../src/server/channel/channel-server.ts'
import type { ChannelServer } from '../../src/server/channel/channel-server.ts'
import { AppRole, createApp } from '../../src/server/composition.ts'
import type { App } from '../../src/server/composition.ts'
import type { Knex } from 'knex'
import {
  channelSocketPath,
  loadConfig,
} from '../../src/server/config/config.ts'
import { openDatabase } from '../../src/server/database/connection.ts'
import { MemoryLogger } from '../../src/server/http/logger.ts'
import { JobKind, JobState } from '../../src/server/jobs/job-types.ts'
import { forkWorker } from '../../src/server/worker/fork-worker.ts'
import {
  PROCESS_TIMEOUT,
  cli,
  flow,
  images,
  makeImage,
  setUpFlowFolders,
} from './flow-test-kit.ts'

const POOL_SIZE = 1
const COMMANDS_AT_ONCE = 3
const SAMPLE_MS = 20

setUpFlowFolders()

type WebServer = { app: App; channel: ChannelServer; close(): Promise<void> }
type Exported = { resultId: string; path: string; bytes: number }

let server: WebServer | undefined
/** The test's own look at the database, which outlives the web server's. */
let database: Knex
/** Every worker process the pool has run during the test. */
const workerPids = new Set<number>()

beforeEach(() => {
  vi.stubEnv('LEMONIFY_CPU_WORKERS', String(POOL_SIZE))
  workerPids.clear()
  database = openDatabase(loadConfig(process.env).database)
})

afterEach(async () => {
  await server?.close()
  server = undefined
  await database.destroy()
})

/** The web server's part in this: its pool of real worker processes and its socket, on the test's database and data folder. */
async function startWebServer(): Promise<WebServer> {
  const config = loadConfig(process.env)
  const logger = new MemoryLogger()
  const app = await createApp(config, {
    role: AppRole.WebServer,
    startWorker: forkWorker(config, { quiet: true }),
    logger,
  })
  await app.startBackground()
  const channel = await startChannelServer({
    socketPath: channelSocketPath(config),
    logger,
    onChange: (userId, event) => app.realtime.publish(userId, event),
    onQueued: (pools) => app.workers?.wake(pools),
  })
  await eventually(() => readyWorkers(app) === POOL_SIZE)
  let closing: Promise<void> | undefined
  server = {
    app,
    channel,
    close() {
      closing ??= (async () => {
        await channel.close()
        await app.close()
      })()
      return closing
    },
  }
  return server
}

function readyWorkers(app: App): number {
  let ready = 0
  for (const worker of app.workers?.workers() ?? []) {
    if (worker.pid !== undefined) workerPids.add(worker.pid)
    if (worker.ready) ready += 1
  }
  return ready
}

async function eventually(check: () => boolean): Promise<void> {
  const deadline = Date.now() + PROCESS_TIMEOUT / 2
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function newDocument(name: string): Promise<string> {
  const file = await makeImage(`${name}.png`)
  const { source } = await cli<{ source: { id: string } }>(
    'source',
    'add',
    file,
  )
  const { document } = await cli<{ document: { id: string } }>(
    'document',
    'create',
    source.id,
  )
  return document.id
}

function exportOf(documentId: string, name: string): Promise<Exported> {
  return images<Exported>(
    'export',
    documentId,
    '--out',
    path.join(flow.workDir, `${name}.png`),
    '--format',
    'png',
  )
}

/** The pid of the process that ran each export job, oldest first. */
async function exportRunners(): Promise<number[]> {
  const rows: Array<{ claimed_by: string | null; state: string }> =
    await database('jobs')
      .where({ kind: JobKind.Export })
      .orderBy('created_at')
      .select('claimed_by', 'state')
  const pids: number[] = []
  for (const row of rows) {
    expect(row.state).toBe(JobState.Done)
    pids.push(Number.parseInt(row.claimed_by?.split('@')[0] ?? '', 10))
  }
  return pids
}

describe('a command whose jobs a running web server can do', () => {
  it(
    'leaves them to the server’s pool and prints the same results as when it does them itself',
    async () => {
      const documentId = await newDocument('cat')
      const web = await startWebServer()

      const pooled = await exportOf(documentId, 'pooled')

      await web.close()
      const alone = await exportOf(documentId, 'alone')

      expect(Object.keys(pooled).sort()).toEqual(Object.keys(alone).sort())
      expect(existsSync(pooled.path)).toBe(true)
      expect(existsSync(alone.path)).toBe(true)
      expect(pooled.bytes).toBe(alone.bytes)
      const [byPool, byCommand] = await exportRunners()
      expect(workerPids.has(byPool ?? 0)).toBe(true)
      expect(workerPids.has(byCommand ?? 0)).toBe(false)
    },
    PROCESS_TIMEOUT * 2,
  )

  it(
    'never runs more jobs at once than the pool allows, however many commands run',
    async () => {
      const documents: string[] = []
      for (let index = 0; index < COMMANDS_AT_ONCE; index += 1) {
        documents.push(await newDocument(`picture-${index}`))
      }
      const web = await startWebServer()
      let mostRunning = 0
      let sampling = true
      const sampler = (async () => {
        while (sampling) {
          const [row] = await database('jobs')
            .where({ state: JobState.Running })
            .count<Array<{ count: number | string }>>({ count: '*' })
          mostRunning = Math.max(mostRunning, Number(row?.count ?? 0))
          readyWorkers(web.app)
          await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS))
        }
      })()

      await Promise.all(
        documents.map((id, index) => exportOf(id, `many-${index}`)),
      )
      sampling = false
      await sampler

      expect(mostRunning).toBeLessThanOrEqual(POOL_SIZE)
      const runners = await exportRunners()
      expect(runners).toHaveLength(COMMANDS_AT_ONCE)
      for (const pid of runners) expect(workerPids.has(pid)).toBe(true)
      expect(
        web.app.workers
          ?.workers()
          .every((worker) => worker.pool === WorkerPool.Cpu),
      ).toBe(true)
    },
    PROCESS_TIMEOUT * 2,
  )
})
