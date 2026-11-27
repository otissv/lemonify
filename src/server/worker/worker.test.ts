// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AiToolId, WorkerPool } from '@/features/ai/ai-tools'
import { decodeEvent } from '@/features/realtime/realtime-events'
import type { RealtimeEvent } from '@/features/realtime/realtime-events'
import { ExportFormat } from '@/features/export/export-settings'
import { createAiStep } from '@/features/pipeline/pipeline'

import { startChannelServer } from '../channel/channel-server'
import { channelSocketPath } from '../config/config'
import { PostgresJobDao } from '../dao/postgres/job-dao'
import { job as jobRecord } from '../dao/contract/job-dao.contract'
import { MemoryLogger } from '../http/logger'
import { JobKind, JobState } from '../jobs/job-types'
import { RealtimeHub } from '../realtime/hub'
import type { RealtimeSocket } from '../realtime/hub'
import { FakeAiEngine, FakeImageEngine } from '../testing/fakes'
import { createTestApp } from '../testing/test-app'
import type { TestApp } from '../testing/test-app'
import { WORKER_DATABASE_POOL_SIZE, createWorker } from './worker'
import type { Worker, WorkerOverrides } from './worker'

const AI_SETTINGS = { model: 'm', scale: 4, iterations: 1, tta: false } as const
const QUIET_MS = 300

let t: TestApp
let engine: FakeImageEngine
let ai: FakeAiEngine
const cleanup: Array<() => Promise<void>> = []

beforeEach(async () => {
  t = await createTestApp()
  engine = new FakeImageEngine()
  ai = new FakeAiEngine()
})

afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
  await t.close()
})

/** A worker on the test app's database and data folder, as the pool would start it. */
async function worker(
  pool: WorkerPool,
  overrides: WorkerOverrides = {},
): Promise<Worker> {
  const made = await createWorker(t.app.config, pool, {
    imageEngine: engine,
    aiEngine: ai,
    logger: new MemoryLogger(),
    changes: t.changes,
    ...overrides,
  })
  cleanup.push(() => made.close())
  return made
}

async function newDocument(colour = '#336699') {
  const source = await t.uploadImage(t.ann, colour, `${colour.slice(1)}.png`)
  return t.app.documents.create(t.ann, source.id)
}

async function eventually(
  check: () => Promise<boolean> | boolean,
): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

async function stateOf(id: string): Promise<JobState> {
  return (await t.app.jobs.get(t.ann, id)).state
}

function released(): { gate: Promise<void>; open(): void } {
  let open = () => {}
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  return { gate, open }
}

describe('a CPU worker', () => {
  it('takes a job from the queue, runs it, records its result and finishes it', async () => {
    const document = await newDocument()
    const queued = await t.app.renders.requestPreview(t.ann, document.id)

    await (await worker(WorkerPool.Cpu)).start()

    await eventually(async () => (await stateOf(queued.id)) === JobState.Done)
    const done = await t.app.jobs.get(t.ann, queued.id)
    expect(done.result).toMatchObject({ kind: JobKind.Preview })
    expect(engine.requests).toHaveLength(1)
  })

  it('runs one job at a time', async () => {
    const held = released()
    engine.gate = held.gate
    const first = await t.app.renders.requestPreview(
      t.ann,
      (await newDocument('#111111')).id,
    )
    const second = await t.app.renders.requestPreview(
      t.ann,
      (await newDocument('#222222')).id,
    )

    await (await worker(WorkerPool.Cpu)).start()
    await eventually(() => engine.requests.length === 1)
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS))
    expect(engine.requests).toHaveLength(1)

    held.open()
    await eventually(
      async () =>
        (await stateOf(first.id)) === JobState.Done &&
        (await stateOf(second.id)) === JobState.Done,
    )
    expect(engine.requests).toHaveLength(2)
  })

  it('leaves the jobs of the GPU pool for the GPU worker', async () => {
    const document = await newDocument()
    await new PostgresJobDao(t.app.database).enqueue([
      jobRecord({
        id: 'gpu-job',
        ownerId: 'ann',
        pool: WorkerPool.Gpu,
        documentId: document.id,
        groupKey: document.id,
        payload: {
          kind: JobKind.Preview,
          documentId: document.id,
          revision: 0,
        },
        createdAt: new Date().toISOString(),
      }),
    ])

    await (await worker(WorkerPool.Cpu)).start()
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS))

    expect(await stateOf('gpu-job')).toBe(JobState.Waiting)
  })

  it('never takes a job another worker took', async () => {
    const held = released()
    engine.gate = held.gate
    const queued: Array<{ id: string }> = []
    for (let index = 0; index < 6; index += 1) {
      const document = await newDocument(`#00000${index}`)
      queued.push(await t.app.renders.requestPreview(t.ann, document.id))
    }

    const one = await worker(WorkerPool.Cpu)
    const two = await worker(WorkerPool.Cpu)
    await Promise.all([one.start(), two.start()])
    await eventually(() => engine.requests.length === 2)
    held.open()

    await eventually(async () => {
      for (const { id } of queued) {
        if ((await stateOf(id)) !== JobState.Done) return false
      }
      return true
    })
    const outputs = engine.requests.map((request) => request.output)
    expect(new Set(outputs).size).toBe(queued.length)
    expect(engine.requests).toHaveLength(queued.length)
  })

  it('finishes the job it is running before it closes, and takes no other', async () => {
    const held = released()
    engine.gate = held.gate
    const first = await t.app.renders.requestPreview(
      t.ann,
      (await newDocument('#111111')).id,
    )
    const second = await t.app.renders.requestPreview(
      t.ann,
      (await newDocument('#222222')).id,
    )
    const running = await worker(WorkerPool.Cpu)
    await running.start()
    await eventually(() => engine.requests.length === 1)

    const closing = running.close()
    held.open()
    await closing

    expect(await stateOf(first.id)).toBe(JobState.Done)
    expect(await stateOf(second.id)).toBe(JobState.Waiting)
  })

  it('keeps a small database pool, so every process together stays inside Postgres’s connection limit', async () => {
    const running = await worker(WorkerPool.Cpu)
    expect(running.database.client.pool.max).toBe(WORKER_DATABASE_POOL_SIZE)
    expect(WORKER_DATABASE_POOL_SIZE).toBeLessThanOrEqual(2)
  })
})

describe('the GPU worker', () => {
  async function aiStepJob(): Promise<string> {
    const document = await newDocument()
    const view = await t.app.documents.get(t.ann, document.id)
    const step = createAiStep({ tool: AiToolId.Upscale, settings: AI_SETTINGS })
    await t.app.documents.change(t.ann, document.id, view.revision, {
      type: 'add-step',
      step,
      index: view.pipeline.steps.length,
    })
    return (await t.app.renders.requestAiStep(t.ann, document.id, step.id)).id
  }

  it('runs AI jobs', async () => {
    const id = await aiStepJob()
    await (await worker(WorkerPool.Gpu)).start()
    await eventually(async () => (await stateOf(id)) === JobState.Done)
    expect(ai.batches).toHaveLength(1)
  })

  it('stops a job when its cancel is requested, and the AI tool is told to stop', async () => {
    const held = released()
    ai.gate = held.gate
    const id = await aiStepJob()
    await (await worker(WorkerPool.Gpu)).start()
    await eventually(() => ai.batches.length === 1)

    await t.app.jobs.cancel(t.ann, id)

    await eventually(async () => (await stateOf(id)) === JobState.Cancelled)
    expect(ai.cancelled).toBe(1)
    held.open()
  })
})

/** A tab the web server has open, as the realtime hub sees it. */
class OpenTab implements RealtimeSocket {
  readonly events: string[] = []
  readonly bufferedAmount = 0
  send(data: string): void {
    this.events.push(data)
  }
  close(): void {}
}

describe('what a worker changes', () => {
  it('reaches the owner’s open tabs through the web server’s socket', async () => {
    const logger = new MemoryLogger()
    const hub = new RealtimeHub(
      { maxConnectionsPerUser: 5, maxConnections: 5, maxBufferedBytes: 4096 },
      logger,
    )
    const channel = await startChannelServer({
      socketPath: channelSocketPath(t.app.config),
      logger,
      onChange: (userId, event) => hub.publish(userId, event),
      onQueued: () => {},
    })
    cleanup.push(() => channel.close())
    const tab = new OpenTab()
    hub.attach(t.ann.userId, tab)
    const id = await (async () => {
      const document = await newDocument()
      return (
        await t.app.renders.requestExport(t.ann, document.id, {
          format: ExportFormat.Png,
          options: {},
          keepMetadata: false,
        })
      ).id
    })()

    // No stand-in for the changes: the worker sends them as it would in production.
    const sending = await createWorker(t.app.config, WorkerPool.Cpu, {
      imageEngine: engine,
      aiEngine: ai,
      logger,
    })
    cleanup.push(() => sending.close())
    await sending.start()

    await eventually(async () => (await stateOf(id)) === JobState.Done)
    const told: RealtimeEvent = { type: 'results.changed' }
    await eventually(() =>
      tab.events.some(
        (event) => JSON.stringify(decodeEvent(event)) === JSON.stringify(told),
      ),
    )
  })
})
