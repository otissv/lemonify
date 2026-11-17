import { createServer } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'

import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'

import { CloseCode, REALTIME_PATH } from '@/features/realtime/realtime-events'
import type { AuthGateway } from '../auth/auth-gateway.ts'
import type { Logger } from '../http/logger.ts'
import { RATE_LIMITS } from '../http/rate-limiter.ts'
import type { FixedWindowRateLimiter } from '../http/rate-limiter.ts'
import type { AttachRefusal, RealtimeHub } from './hub.ts'

/** The largest message a client may send. It may send none, so this only bounds what is read before it is refused. */
const MAX_CLIENT_MESSAGE_BYTES = 1024
const SECOND = 1000
/** How long connections get to say goodbye when the server stops, before the rest are cut. */
const SHUTDOWN_GRACE_MS = 1000
const DRAIN_POLL_MS = 10

export type RealtimeTiming = {
  /** How often every connection is pinged and sent a heartbeat. One that has not answered the last ping is closed. */
  heartbeatMs: number
  /** How often each connection's sign-in is checked again. */
  sessionCheckMs: number
}

export const DEFAULT_REALTIME_TIMING: RealtimeTiming = {
  heartbeatMs: 30 * SECOND,
  sessionCheckMs: 60 * SECOND,
}

export type RealtimeServerDeps = {
  hub: RealtimeHub
  auth: Pick<AuthGateway, 'getActor'>
  logger: Logger
  limiter: FixedWindowRateLimiter
  /** Pages allowed to open a connection; a page on any other site is refused even with a valid sign-in. */
  trustedOrigins: ReadonlyArray<string>
  host: string
  /** 0 picks a free port, for tests. */
  port: number
  timing?: RealtimeTiming
}

export type RealtimeServer = {
  port: number
  close(): Promise<void>
}

type Connection = {
  socket: WebSocket
  userId: string
  /** The sign-in the connection was opened with, to check again later. */
  cookie: string
  alive: boolean
  detach: () => void
}

type Refusal = { status: number; text: string; retryAfterSeconds?: number }

const REFUSALS = {
  notFound: { status: 404, text: 'Not Found' },
  forbidden: { status: 403, text: 'Forbidden' },
  unauthorized: { status: 401, text: 'Unauthorized' },
  badRequest: { status: 400, text: 'Bad Request' },
  failed: { status: 500, text: 'Internal Server Error' },
} as const satisfies Record<string, Refusal>

const FULL: Refusal = {
  status: 503,
  text: 'Service Unavailable',
  retryAfterSeconds: 30,
}

const CLOSE_SIGNED_OUT = 'Sign in to keep getting updates.'
const CLOSE_NO_MESSAGES = 'This channel only sends updates.'
const CLOSE_SHUTDOWN = 'The server is stopping.'

function refuse(socket: Duplex, refusal: Refusal): void {
  const retry =
    refusal.retryAfterSeconds === undefined
      ? ''
      : `Retry-After: ${refusal.retryAfterSeconds}\r\n`
  socket.end(
    `HTTP/1.1 ${refusal.status} ${refusal.text}\r\n${retry}Connection: close\r\nContent-Length: 0\r\n\r\n`,
  )
}

function cookieOf(headers: IncomingHttpHeaders): string | undefined {
  const { cookie } = headers
  return typeof cookie === 'string' && cookie !== '' ? cookie : undefined
}

function pathOf(request: IncomingMessage): string | undefined {
  try {
    return new URL(request.url ?? '', 'http://realtime.invalid').pathname
  } catch {
    return undefined
  }
}

/**
 * The server that tells open tabs when something changed. It is its own
 * listener, since the website's server only handles requests that end in a
 * response; a tab opens one connection here and the hub sends events down it.
 *
 * A connection is only opened for a page of this site (its Origin is checked,
 * so another site cannot use a visitor's sign-in), for a signed-in person, and
 * within limits; it only ever receives events for that person; it takes
 * nothing from the client; and it is closed when the person's sign-in ends,
 * when it stops answering, or when it cannot keep up.
 */
export function startRealtimeServer(
  deps: RealtimeServerDeps,
): Promise<RealtimeServer> {
  const timing = deps.timing ?? DEFAULT_REALTIME_TIMING
  const connections = new Set<Connection>()
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_CLIENT_MESSAGE_BYTES,
    perMessageDeflate: false,
    clientTracking: false,
  })
  const server: Server = createServer((_request, response) => {
    response.writeHead(426, {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Content-Length': 0,
    })
    response.end()
  })

  function allowed(request: IncomingMessage): Refusal | undefined {
    if (pathOf(request) !== REALTIME_PATH) return REFUSALS.notFound
    if (request.method !== 'GET') return REFUSALS.badRequest
    const { origin } = request.headers
    if (typeof origin !== 'string' || !deps.trustedOrigins.includes(origin)) {
      return REFUSALS.forbidden
    }
    return undefined
  }

  function limited(key: string): Refusal | undefined {
    const decision = deps.limiter.take(`realtime:${key}`, RATE_LIMITS.realtime)
    if (decision.allowed) return undefined
    return {
      status: 429,
      text: 'Too Many Requests',
      retryAfterSeconds: decision.retryAfterSeconds,
    }
  }

  async function admit(
    request: IncomingMessage,
  ): Promise<{ refusal: Refusal } | { userId: string; cookie: string }> {
    const early = allowed(request)
    if (early) return { refusal: early }
    const tooMany = limited(`address:${request.socket.remoteAddress ?? ''}`)
    if (tooMany) return { refusal: tooMany }
    const cookie = cookieOf(request.headers)
    if (cookie === undefined) return { refusal: REFUSALS.unauthorized }
    const actor = await deps.auth.getActor(new Headers({ cookie }))
    if (actor === null) return { refusal: REFUSALS.unauthorized }
    const perUser = limited(`user:${actor.userId}`)
    if (perUser) return { refusal: perUser }
    if (deps.hub.refusalFor(actor.userId) !== undefined) {
      return { refusal: FULL }
    }
    return { userId: actor.userId, cookie }
  }

  function open(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    userId: string,
    cookie: string,
  ): void {
    sockets.handleUpgrade(request, socket, head, (ws) => {
      const attached = deps.hub.attach(userId, ws)
      if (typeof attached === 'string') {
        ws.close(CloseCode.TryAgainLater, refusalText(attached))
        return
      }
      const connection: Connection = {
        socket: ws,
        userId,
        cookie,
        alive: true,
        detach: attached.detach,
      }
      connections.add(connection)
      deps.logger.info('realtime connected', {
        userId,
        connections: deps.hub.connectionsOf(userId),
      })
      ws.on('pong', () => {
        connection.alive = true
      })
      ws.on('message', () => {
        ws.close(CloseCode.PolicyViolation, CLOSE_NO_MESSAGES)
      })
      ws.on('error', (error) => {
        deps.logger.warn('realtime connection error', {
          userId,
          detail: error.message,
        })
        ws.terminate()
      })
      ws.on('close', () => {
        connection.detach()
        connections.delete(connection)
      })
    })
  }

  server.on('upgrade', (request, socket, head) => {
    socket.on('error', () => {
      socket.destroy()
    })
    admit(request)
      .then((result) => {
        if ('refusal' in result) {
          refuse(socket, result.refusal)
          return
        }
        open(request, socket, head, result.userId, result.cookie)
      })
      .catch((error: unknown) => {
        deps.logger.error('realtime sign-in check failed', {
          detail: error instanceof Error ? error.message : String(error),
        })
        refuse(socket, REFUSALS.failed)
      })
  })

  const heartbeat = setInterval(() => {
    for (const connection of [...connections]) {
      if (!connection.alive) {
        connection.socket.terminate()
        continue
      }
      connection.alive = false
      connection.socket.ping()
    }
    deps.hub.broadcast({ type: 'heartbeat' })
  }, timing.heartbeatMs)

  async function checkSession(connection: Connection): Promise<void> {
    try {
      const actor = await deps.auth.getActor(
        new Headers({ cookie: connection.cookie }),
      )
      if (actor?.userId === connection.userId) return
      connection.socket.close(CloseCode.SignedOut, CLOSE_SIGNED_OUT)
    } catch (error) {
      deps.logger.warn('realtime sign-in recheck failed', {
        userId: connection.userId,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const sessionCheck = setInterval(() => {
    for (const connection of [...connections]) void checkSession(connection)
  }, timing.sessionCheckMs)

  heartbeat.unref()
  sessionCheck.unref()

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(deps.port, deps.host, () => {
      server.off('error', reject)
      server.on('error', (error) => {
        deps.logger.error('realtime server error', { detail: error.message })
      })
      const address = server.address()
      const port =
        typeof address === 'object' && address !== null
          ? address.port
          : deps.port
      resolve({
        port,
        async close() {
          clearInterval(heartbeat)
          clearInterval(sessionCheck)
          deps.hub.closeAll(CloseCode.GoingAway, CLOSE_SHUTDOWN)
          await drained(connections, SHUTDOWN_GRACE_MS)
          for (const connection of connections) connection.socket.terminate()
          sockets.close()
          server.closeAllConnections()
          await new Promise<void>((done) => {
            server.close(() => {
              done()
            })
          })
        },
      })
    })
  })
}

async function drained(
  connections: ReadonlySet<Connection>,
  graceMs: number,
): Promise<void> {
  const deadline = Date.now() + graceMs
  while (connections.size > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS))
  }
}

function refusalText(refusal: AttachRefusal): string {
  return refusal === 'user-full'
    ? 'Too many tabs are open.'
    : 'The server is full.'
}
