// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { WorkerPool } from '@/features/ai/ai-tools'
import type { RealtimeEvent } from '@/features/realtime/realtime-events'
import { MemoryLogger } from '../http/logger'
import { startChannelServer } from './channel-server'
import type { ChannelServer } from './channel-server'
import { ChannelClient } from './channel-client'

const EVENT: RealtimeEvent = { type: 'results.changed' }
/** A command that changes something publishes a handful of events; this many is far more. */
const MANY = 1000
/** What publishing and closing may add to a command when no web server runs. */
const NO_SERVER_BUDGET_MS = 50

let dir = ''
let socketPath = ''
let logger: MemoryLogger
let received: Array<{ userId: string; event: RealtimeEvent }>
let queued: WorkerPool[][]
const cleanup: Array<() => Promise<void>> = []

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'lemonify-publisher-'))
  socketPath = path.join(dir, 'run', 'lemonify.sock')
  logger = new MemoryLogger()
  received = []
  queued = []
})

afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
  rmSync(dir, { recursive: true, force: true })
})

async function server(): Promise<ChannelServer> {
  const started = await startChannelServer({
    socketPath,
    logger,
    onChange: (userId, event) => received.push({ userId, event }),
    onQueued: (pools) => queued.push([...pools]),
  })
  cleanup.push(() => started.close())
  return started
}

function publisher(): ChannelClient {
  const made = new ChannelClient(socketPath, logger)
  cleanup.push(() => made.close())
  return made
}

async function eventually(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('a process that is not the web server', () => {
  it('sends each change to the web server, in order', async () => {
    await server()
    const changes = publisher()
    changes.publish('ann', { type: 'document.deleted', documentId: 'doc-1' })
    changes.publish('ann', EVENT)
    await eventually(() => received.length === 2)
    expect(received).toEqual([
      {
        userId: 'ann',
        event: { type: 'document.deleted', documentId: 'doc-1' },
      },
      { userId: 'ann', event: EVENT },
    ])
  })

  it('tells the web server which pools it queued jobs for, so their workers start on them', async () => {
    await server()
    const client = publisher()
    client.queued(new Set([WorkerPool.Cpu, WorkerPool.Gpu]))
    await eventually(() => queued.length === 1)
    expect(queued[0]?.sort()).toEqual([WorkerPool.Cpu, WorkerPool.Gpu])
  })

  it('says nothing about jobs queued for no pool', async () => {
    await server()
    const client = publisher()
    client.queued(new Set())
    client.publish('ann', EVENT)
    await eventually(() => received.length === 1)
    expect(queued).toEqual([])
  })

  it('delivers what it published before it closes, as a command that ends straight after its change', async () => {
    await server()
    const changes = new ChannelClient(socketPath, logger)
    for (let index = 0; index < 50; index += 1) changes.publish('ann', EVENT)
    await changes.close()
    await eventually(() => received.length === 50)
  })

  it('does nothing, quickly and quietly, when no web server is running', async () => {
    const changes = new ChannelClient(socketPath, logger)
    const started = performance.now()
    for (let index = 0; index < MANY; index += 1) {
      changes.publish('ann', EVENT)
      changes.queued(new Set([WorkerPool.Cpu]))
    }
    await changes.close()
    expect(performance.now() - started).toBeLessThan(NO_SERVER_BUDGET_MS)
    expect(logger.lines).toEqual([])
  })

  it('never throws from publish, whatever the socket does', () => {
    const changes = publisher()
    expect(() => {
      for (let index = 0; index < 10; index += 1) changes.publish('ann', EVENT)
    }).not.toThrow()
  })

  it('reaches a web server that starts after it, and one that restarts', async () => {
    const changes = publisher()
    changes.publish('ann', EVENT)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const first = await server()
    await eventually(() => {
      changes.publish('ann', EVENT)
      return received.length > 0
    })
    await first.close()
    received.length = 0
    changes.publish('ann', EVENT)
    await server()
    await eventually(() => {
      changes.publish('ann', EVENT)
      return received.length > 0
    })
  })

  it('keeps at most maxPendingBytes waiting to be sent, and warns once when it drops changes', async () => {
    await server()
    const bounded = new ChannelClient(socketPath, logger, {
      maxPendingBytes: 1024,
    })
    for (let index = 0; index < MANY; index += 1) bounded.publish('ann', EVENT)
    await bounded.close()
    await eventually(() => received.length > 0)
    expect(received.length).toBeLessThan(MANY)
    expect(logger.lines.filter((line) => line.level === 'warn')).toEqual([
      {
        level: 'warn',
        message:
          'The web server is not reading changes fast enough; some were not sent to open tabs',
        fields: { socket: socketPath },
      },
    ])
  })
})
