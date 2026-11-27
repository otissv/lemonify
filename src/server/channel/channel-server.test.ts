// @vitest-environment node
import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createConnection } from 'node:net'
import type { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { RealtimeEvent } from '@/features/realtime/realtime-events'
import { MemoryLogger } from '../http/logger'
import { WorkerPool } from '@/features/ai/ai-tools'

import {
  encodeChannelChange,
  encodeChannelQueued,
  MAX_CHANNEL_LINE_BYTES,
} from './channel-message'
import { ChannelInUseError, startChannelServer } from './channel-server'
import type { ChannelServer } from './channel-server'

const UPDATED: RealtimeEvent = { type: 'document.deleted', documentId: 'doc-1' }
const OTHER: RealtimeEvent = { type: 'results.changed' }
const OWNER_ONLY = 0o600
const OWNER_ONLY_DIRECTORY = 0o700
const PERMISSION_BITS = 0o777

let dir = ''
let socketPath = ''
let logger: MemoryLogger
let received: Array<{ userId: string; event: RealtimeEvent }>
let queued: WorkerPool[][]
const cleanup: Array<() => Promise<void> | void> = []

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'lemonify-channel-'))
  socketPath = path.join(dir, 'run', 'lemonify.sock')
  logger = new MemoryLogger()
  received = []
  queued = []
})

afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
  rmSync(dir, { recursive: true, force: true })
})

async function start(): Promise<ChannelServer> {
  const server = await startChannelServer({
    socketPath,
    logger,
    onChange: (userId, event) => received.push({ userId, event }),
    onQueued: (pools) => queued.push([...pools]),
  })
  cleanup.push(() => server.close())
  return server
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath })
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
    cleanup.push(() => {
      socket.destroy()
    })
  })
}

function closed(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.destroyed) resolve()
    else socket.once('close', () => resolve())
  })
}

/** A process that listens on the socket and is killed, so the socket file stays behind. */
async function leaveStaleSocket(): Promise<void> {
  mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 })
  const child = spawn(process.execPath, [
    '-e',
    `require('node:net').createServer().listen(${JSON.stringify(socketPath)}, () => console.log('up'))`,
  ])
  await new Promise<void>((resolve) =>
    child.stdout.once('data', () => resolve()),
  )
  const exited = new Promise<void>((resolve) =>
    child.once('exit', () => resolve()),
  )
  child.kill('SIGKILL')
  await exited
}

async function eventually(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('the channel server', () => {
  it('passes on each change a process sends, in order, with the person it is for', async () => {
    await start()
    const client = await connect()
    client.write(encodeChannelChange('ann', UPDATED))
    client.write(encodeChannelChange('bob', OTHER))
    await eventually(() => received.length === 2)
    expect(received).toEqual([
      { userId: 'ann', event: UPDATED },
      { userId: 'bob', event: OTHER },
    ])
  })

  it('passes on the pools another process queued jobs for', async () => {
    await start()
    const client = await connect()
    client.write(encodeChannelQueued([WorkerPool.Gpu]))
    client.write(encodeChannelChange('ann', UPDATED))
    await eventually(() => queued.length === 1 && received.length === 1)
    expect(queued).toEqual([[WorkerPool.Gpu]])
  })

  it('reads a message that arrives in pieces, and several in one piece', async () => {
    await start()
    const client = await connect()
    const one = encodeChannelChange('ann', UPDATED)
    client.write(one.slice(0, 10))
    await new Promise((resolve) => setTimeout(resolve, 20))
    client.write(one.slice(10) + encodeChannelChange('ann', OTHER))
    await eventually(() => received.length === 2)
    expect(received.map(({ event }) => event)).toEqual([UPDATED, OTHER])
  })

  it('takes changes from several processes at once', async () => {
    await start()
    const clients = await Promise.all([connect(), connect(), connect()])
    for (const [index, client] of clients.entries()) {
      client.write(encodeChannelChange(`user-${index}`, OTHER))
    }
    await eventually(() => received.length === 3)
    expect(received.map(({ userId }) => userId).sort()).toEqual([
      'user-0',
      'user-1',
      'user-2',
    ])
  })

  it('logs and drops a message it does not take, and goes on reading the next', async () => {
    await start()
    const client = await connect()
    client.write('not json\n')
    client.write(
      `${JSON.stringify({ v: 1, userId: 'ann', event: { type: 'nope' } })}\n`,
    )
    client.write(encodeChannelChange('ann', UPDATED))
    await eventually(() => received.length === 1)
    expect(received).toEqual([{ userId: 'ann', event: UPDATED }])
    expect(
      logger.lines
        .filter((line) => line.level === 'warn')
        .map((line) => line.message),
    ).toEqual([
      'A process sent a message the web server does not take; it was dropped',
      'A process sent a message the web server does not take; it was dropped',
    ])
  })

  it('cuts a connection that sends a line longer than any change, and keeps serving the others', async () => {
    await start()
    const flooding = await connect()
    const other = await connect()
    flooding.write('x'.repeat(MAX_CHANNEL_LINE_BYTES + 1))
    await closed(flooding)
    other.write(encodeChannelChange('ann', UPDATED))
    await eventually(() => received.length === 1)
    expect(logger.lines.map((line) => line.message)).toContain(
      'A process sent a line longer than any change; its connection was closed',
    )
  })

  it('is reachable only by the user who runs it', async () => {
    await start()
    expect(statSync(socketPath).mode & PERMISSION_BITS).toBe(OWNER_ONLY)
    expect(statSync(path.dirname(socketPath)).mode & PERMISSION_BITS).toBe(
      OWNER_ONLY_DIRECTORY,
    )
  })

  it('removes its socket when it stops, and closes the connections still open', async () => {
    const server = await start()
    const client = await connect()
    await server.close()
    await closed(client)
    expect(() => statSync(socketPath)).toThrow()
  })

  it('replaces a socket left by a web server that was killed', async () => {
    await leaveStaleSocket()
    expect(statSync(socketPath).isSocket()).toBe(true)
    await start()
    const client = await connect()
    client.write(encodeChannelChange('ann', UPDATED))
    await eventually(() => received.length === 1)
  })

  it('refuses to start when another web server is already listening on the socket', async () => {
    await start()
    await expect(
      startChannelServer({
        socketPath,
        logger,
        onChange: () => {},
        onQueued: () => {},
      }),
    ).rejects.toBeInstanceOf(ChannelInUseError)
    const client = await connect()
    client.write(encodeChannelChange('ann', UPDATED))
    await eventually(() => received.length === 1)
  })

  it('closes a socket folder that other users could open', async () => {
    mkdirSync(path.dirname(socketPath), { recursive: true })
    chmodSync(path.dirname(socketPath), 0o755)
    await start()
    expect(statSync(path.dirname(socketPath)).mode & PERMISSION_BITS).toBe(
      OWNER_ONLY_DIRECTORY,
    )
  })
})
