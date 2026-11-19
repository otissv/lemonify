import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'

import { decodeEvent } from '@/features/realtime/realtime-events'
import type { RealtimeEvent } from '@/features/realtime/realtime-events'
import { DEFAULT_SITE_ORIGIN } from '../config/site-port.ts'
import type { Actor } from '../domain/actor.ts'
import type { Logger } from '../http/logger.ts'
import { FixedWindowRateLimiter } from '../http/rate-limiter.ts'
import { RealtimeHub } from './hub.ts'
import { startRealtimeServer } from './realtime-server.ts'
import type { RealtimeServer, RealtimeTiming } from './realtime-server.ts'

const ORIGIN = DEFAULT_SITE_ORIGIN
const ANN: Actor = { userId: 'ann', name: 'Ann' }
const BEA: Actor = { userId: 'bea', name: 'Bea' }
const SLOW: RealtimeTiming = { heartbeatMs: 40, sessionCheckMs: 40 }
const QUIET: RealtimeTiming = { heartbeatMs: 60_000, sessionCheckMs: 60_000 }

let server: RealtimeServer | undefined
let hub: RealtimeHub
let logger: Logger
let sessions: Map<string, Actor | null | Error>
const open: WebSocket[] = []

function actorFor(headers: Headers): Promise<Actor | null> {
  const cookie = headers.get('cookie') ?? ''
  const found = sessions.get(cookie)
  if (found instanceof Error) return Promise.reject(found)
  return Promise.resolve(found ?? null)
}

async function start(
  options: {
    timing?: RealtimeTiming
    maxPerUser?: number
    maxTotal?: number
  } = {},
): Promise<number> {
  logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  hub = new RealtimeHub(
    {
      maxConnectionsPerUser: options.maxPerUser ?? 5,
      maxConnections: options.maxTotal ?? 50,
      maxBufferedBytes: 1_000_000,
    },
    logger,
  )
  server = await startRealtimeServer({
    hub,
    auth: { getActor: actorFor },
    logger,
    limiter: new FixedWindowRateLimiter(),
    trustedOrigins: [ORIGIN],
    host: '127.0.0.1',
    port: 0,
    timing: options.timing ?? QUIET,
  })
  return server.port
}

type Outcome =
  | { opened: WebSocket }
  | { status: number; headers: Record<string, string | string[] | undefined> }

function connect(
  port: number,
  options: {
    origin?: string | null
    cookie?: string | null
    path?: string
    autoPong?: boolean
  } = {},
): Promise<Outcome> {
  const headers: Record<string, string> = {}
  if (options.origin !== null) headers.Origin = options.origin ?? ORIGIN
  if (options.cookie !== null) headers.Cookie = options.cookie ?? 'session=ann'
  const socket = new WebSocket(
    `ws://127.0.0.1:${port}${options.path ?? '/realtime'}`,
    { headers, autoPong: options.autoPong ?? true },
  )
  open.push(socket)
  return new Promise((resolve) => {
    socket.once('open', () => {
      resolve({ opened: socket })
    })
    socket.once('unexpected-response', (_request, response) => {
      resolve({ status: response.statusCode ?? 0, headers: response.headers })
      response.resume()
    })
    socket.once('error', () => undefined)
  })
}

async function connected(
  port: number,
  cookie = 'session=ann',
): Promise<WebSocket> {
  const outcome = await connect(port, { cookie })
  if (!('opened' in outcome)) throw new Error(`Refused: ${outcome.status}`)
  return outcome.opened
}

function nextEvent(socket: WebSocket): Promise<RealtimeEvent | undefined> {
  return new Promise((resolve) => {
    socket.once('message', (data) => {
      resolve(decodeEvent(data.toString()))
    })
  })
}

function closed(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once('close', (code, reason) => {
      resolve({ code, reason: reason.toString() })
    })
  })
}

async function statusOf(port: number, options: Parameters<typeof connect>[1]) {
  const outcome = await connect(port, options)
  if ('opened' in outcome) return 101
  return outcome.status
}

beforeEach(() => {
  sessions = new Map([
    ['session=ann', ANN],
    ['session=bea', BEA],
  ])
})

afterEach(async () => {
  for (const socket of open.splice(0)) socket.terminate()
  await server?.close()
  server = undefined
})

describe('the realtime server', () => {
  describe('who may connect', () => {
    it('lets a signed-in person on a page of this site in', async () => {
      const port = await start()

      expect(await statusOf(port, {})).toBe(101)
    })

    it('refuses a page of another site, even with a valid sign-in', async () => {
      const port = await start()

      expect(await statusOf(port, { origin: 'https://evil.example' })).toBe(403)
      expect(await statusOf(port, { origin: 'null' })).toBe(403)
      expect(await statusOf(port, { origin: `${ORIGIN}.evil.example` })).toBe(
        403,
      )
      expect(hub.size).toBe(0)
    })

    it('refuses a request with no origin, which a browser always sends', async () => {
      const port = await start()

      expect(await statusOf(port, { origin: null })).toBe(403)
    })

    it('refuses someone who is not signed in', async () => {
      const port = await start()

      expect(await statusOf(port, { cookie: null })).toBe(401)
      expect(await statusOf(port, { cookie: 'session=stranger' })).toBe(401)
    })

    it('refuses when the sign-in check itself fails, and says nothing about why', async () => {
      const port = await start()
      sessions.set('session=ann', new Error('database is down'))

      const outcome = await connect(port, {})

      expect('status' in outcome && outcome.status).toBe(500)
      expect(logger.error).toHaveBeenCalledWith(
        'realtime sign-in check failed',
        { detail: 'database is down' },
      )
    })

    it('answers only on its own path', async () => {
      const port = await start()

      expect(await statusOf(port, { path: '/' })).toBe(404)
      expect(await statusOf(port, { path: '/realtime/other' })).toBe(404)
      expect(await statusOf(port, { path: '/api/auth/session' })).toBe(404)
    })

    it('tells an ordinary request that this is a websocket address', async () => {
      const port = await start()

      const response = await fetch(`http://127.0.0.1:${port}/realtime`)

      expect(response.status).toBe(426)
      expect(response.headers.get('upgrade')).toBe('websocket')
      expect(await response.text()).toBe('')
    })
  })

  describe('limits', () => {
    it('slows down an address that opens connections too often', async () => {
      const port = await start()

      const statuses: number[] = []
      for (let attempt = 0; attempt < 61; attempt += 1) {
        statuses.push(await statusOf(port, { cookie: null }))
      }

      expect(statuses.slice(0, 60).every((status) => status === 401)).toBe(true)
      expect(statuses[60]).toBe(429)
    })

    it('refuses a person more tabs than the limit and says to wait', async () => {
      const port = await start({ maxPerUser: 2 })
      await connected(port)
      await connected(port)

      const outcome = await connect(port, {})

      expect('status' in outcome && outcome.status).toBe(503)
      expect('headers' in outcome && outcome.headers['retry-after']).toBe('30')
      expect(await statusOf(port, { cookie: 'session=bea' })).toBe(101)
    })

    it('refuses everyone once the server has as many connections as it allows', async () => {
      const port = await start({ maxTotal: 2 })
      await connected(port)
      await connected(port, 'session=bea')

      expect(await statusOf(port, { cookie: 'session=bea' })).toBe(503)
    })

    it('takes a tab again once one has closed', async () => {
      const port = await start({ maxPerUser: 1 })
      const first = await connected(port)
      const done = closed(first)
      first.close()
      await done
      await vi.waitFor(() => {
        expect(hub.connectionsOf('ann')).toBe(0)
      })

      expect(await statusOf(port, {})).toBe(101)
    })
  })

  describe('what it sends', () => {
    it('sends a person the events for them, as they happen', async () => {
      const port = await start()
      const socket = await connected(port)
      const received = nextEvent(socket)

      hub.publish('ann', { type: 'documents.changed' })

      expect(await received).toEqual({ type: 'documents.changed' })
    })

    it('never sends one person’s events to another', async () => {
      const port = await start()
      const ann = await connected(port)
      const bea = await connected(port, 'session=bea')
      const seenByBea: unknown[] = []
      bea.on('message', (data) => seenByBea.push(data.toString()))
      const forAnn = nextEvent(ann)

      hub.publish('ann', { type: 'results.changed' })
      await forAnn
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(seenByBea).toEqual([])
    })

    it('sends every tab of one person the same event', async () => {
      const port = await start()
      const first = await connected(port)
      const second = await connected(port)
      const both = Promise.all([nextEvent(first), nextEvent(second)])

      hub.publish('ann', { type: 'workflows.changed' })

      expect(await both).toEqual([
        { type: 'workflows.changed' },
        { type: 'workflows.changed' },
      ])
    })

    it('sends a heartbeat now and then', async () => {
      const port = await start({ timing: SLOW })
      const socket = await connected(port)

      expect(await nextEvent(socket)).toEqual({ type: 'heartbeat' })
      expect(await nextEvent(socket)).toEqual({ type: 'heartbeat' })
    })
  })

  describe('what it takes', () => {
    it('closes a connection that sends anything', async () => {
      const port = await start()
      const socket = await connected(port)
      const done = closed(socket)

      socket.send('hello')

      expect(await done).toEqual({
        code: 1008,
        reason: 'This channel only sends updates.',
      })
      await vi.waitFor(() => {
        expect(hub.size).toBe(0)
      })
    })

    it('closes a connection that sends something large', async () => {
      const port = await start()
      const socket = await connected(port)
      const done = closed(socket)

      socket.send('x'.repeat(100_000))

      expect((await done).code).toBe(1009)
    })
  })

  describe('keeping connections honest', () => {
    it('closes a connection that stops answering pings', async () => {
      const port = await start({ timing: SLOW })
      const outcome = await connect(port, { autoPong: false })
      if (!('opened' in outcome)) throw new Error('refused')
      const done = closed(outcome.opened)

      await done

      await vi.waitFor(() => {
        expect(hub.size).toBe(0)
      })
    })

    it('keeps a connection that answers', async () => {
      const port = await start({ timing: SLOW })
      const socket = await connected(port)
      let closedEarly = false
      socket.on('close', () => {
        closedEarly = true
      })

      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(closedEarly).toBe(false)
    })

    it('closes a connection whose sign-in has ended, telling it to stay out', async () => {
      const port = await start({ timing: SLOW })
      const socket = await connected(port)
      const done = closed(socket)

      sessions.set('session=ann', null)

      expect((await done).code).toBe(4401)
    })

    it('closes a connection whose cookie now belongs to someone else', async () => {
      const port = await start({ timing: SLOW })
      const socket = await connected(port)
      const done = closed(socket)

      sessions.set('session=ann', BEA)

      expect((await done).code).toBe(4401)
    })

    it('keeps a connection when the sign-in could not be checked, and logs it', async () => {
      const port = await start({ timing: SLOW })
      const socket = await connected(port)
      let closedEarly = false
      socket.on('close', () => {
        closedEarly = true
      })

      sessions.set('session=ann', new Error('database is down'))
      await vi.waitFor(() => {
        expect(logger.warn).toHaveBeenCalledWith(
          'realtime sign-in recheck failed',
          { userId: 'ann', detail: 'database is down' },
        )
      })

      expect(closedEarly).toBe(false)
    })
  })

  describe('stopping', () => {
    it('tells every connection it is going away, and frees the port', async () => {
      const port = await start()
      const socket = await connected(port)
      const done = closed(socket)

      await server?.close()
      server = undefined

      expect((await done).code).toBe(1001)
      await expect(fetch(`http://127.0.0.1:${port}/realtime`)).rejects.toThrow()
    })
  })
})
