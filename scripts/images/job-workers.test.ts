// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkerPool } from '../../src/features/ai/ai-tools.ts'
import { startChannelServer } from '../../src/server/channel/channel-server.ts'
import type { ChannelServer } from '../../src/server/channel/channel-server.ts'
import { channelSocketPath } from '../../src/server/config/config.ts'
import { MemoryLogger } from '../../src/server/http/logger.ts'
import { JobState } from '../../src/server/jobs/job-types.ts'
import type { JobView } from '../../src/server/services/job-service.ts'
import { createTestApp } from '../../src/server/testing/test-app.ts'
import type { TestApp } from '../../src/server/testing/test-app.ts'
import { createWorker } from '../../src/server/worker/worker.ts'
import { withWorkers } from './job-workers.ts'

/** How often the command checks that the web server is still there, shortened for the test. */
const WATCH_MS = 50

let t: TestApp
let channel: ChannelServer | undefined
let queued: WorkerPool[][]
const cleanup: Array<() => Promise<void>> = []

beforeEach(async () => {
  t = await createTestApp()
  queued = []
})

afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
  await channel?.close()
  channel = undefined
  await t.close()
})

/** Stands in for the web server: its socket answers, and `onQueued` hears what the command queued. */
async function webServer(
  onQueued: (pools: ReadonlyArray<WorkerPool>) => void = () => {},
): Promise<void> {
  channel = await startChannelServer({
    socketPath: channelSocketPath(t.app.config),
    logger: new MemoryLogger(),
    onChange: () => {},
    onQueued: (pools) => {
      queued.push([...pools])
      onQueued(pools)
    },
  })
}

async function queuePreview(): Promise<string> {
  const source = await t.uploadImage(t.ann)
  const document = await t.app.documents.create(t.ann, source.id)
  return (await t.app.renders.requestPreview(t.ann, document.id)).id
}

describe('a command that queues jobs', () => {
  it('leaves them to the web server’s pool when its socket answers, and waits for their results', async () => {
    const pool = await createWorker(t.app.config, WorkerPool.Cpu, {
      imageEngine: t.imageEngine,
      aiEngine: t.aiEngine,
      logger: new MemoryLogger(),
      changes: t.changes,
    })
    cleanup.push(() => pool.close())
    // The pool takes jobs only once it hears they were queued.
    await webServer(() => void pool.start())
    const ownScheduler = vi.spyOn(t.app.scheduler, 'start')

    const done: JobView = await withWorkers(t.app, async () =>
      t.app.jobs.waitFor(t.ann, await queuePreview()),
    )

    expect(done.state).toBe(JobState.Done)
    expect(ownScheduler).not.toHaveBeenCalled()
    expect(queued).toContainEqual([WorkerPool.Cpu])
  })

  it('does them itself when no web server is running', async () => {
    const ownScheduler = vi.spyOn(t.app.scheduler, 'start')

    const done = await withWorkers(t.app, async () =>
      t.app.jobs.waitFor(t.ann, await queuePreview()),
    )

    expect(done.state).toBe(JobState.Done)
    expect(ownScheduler).toHaveBeenCalledTimes(1)
  })

  it('does the rest itself when the web server stops while it waits', async () => {
    // A web server whose pool never takes the job.
    await webServer()
    const ownScheduler = vi.spyOn(t.app.scheduler, 'start')

    const done = await withWorkers(
      t.app,
      async () => {
        const id = await queuePreview()
        await channel?.close()
        return t.app.jobs.waitFor(t.ann, id)
      },
      { watchMs: WATCH_MS },
    )

    expect(done.state).toBe(JobState.Done)
    expect(ownScheduler).toHaveBeenCalledTimes(1)
  })

  it('stops its own scheduler when the command ends, and its watch of the web server', async () => {
    await webServer()
    const ownScheduler = vi.spyOn(t.app.scheduler, 'start')

    await withWorkers(t.app, async () => 'nothing queued', {
      watchMs: WATCH_MS,
    })
    await channel?.close()
    await new Promise((resolve) => setTimeout(resolve, WATCH_MS * 4))

    expect(ownScheduler).not.toHaveBeenCalled()
  })
})
