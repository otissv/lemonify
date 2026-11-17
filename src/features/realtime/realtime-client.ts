import { CloseCode, decodeEvent } from '@/features/realtime/realtime-events'
import type { RealtimeEvent } from '@/features/realtime/realtime-events'

export const RealtimeStatus = {
  /** Opening the first connection. */
  Connecting: 'connecting',
  Open: 'open',
  /** Lost the connection and trying again. */
  Reconnecting: 'reconnecting',
  /** Not trying: stopped, or signed out. */
  Stopped: 'stopped',
} as const

export type RealtimeStatus =
  (typeof RealtimeStatus)[keyof typeof RealtimeStatus]

/** The part of the browser's WebSocket the client uses, so it can be tested without one. */
export interface SocketLike {
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: { code: number }) => void) | null
  onerror: (() => void) | null
  close(code?: number, reason?: string): void
}

export type TimerHandle = unknown

export type RealtimeEnvironment = {
  connect(url: string): SocketLike
  setTimer(callback: () => void, milliseconds: number): TimerHandle
  clearTimer(handle: TimerHandle): void
  random(): number
}

export const BACKOFF = {
  firstDelayMs: 1000,
  maxDelayMs: 30_000,
  /** A connection that stays open this long is a healthy one, so the next loss starts the delays again. */
  stableAfterMs: 5000,
  /** The server sends a heartbeat every 30 seconds; this long without any message means the connection is dead. */
  silenceLimitMs: 75_000,
} as const

export type RealtimeClientOptions = {
  url: string
  onEvent: (event: RealtimeEvent) => void
  onStatus: (status: RealtimeStatus) => void
  /** Called each time a connection opens, so the caller can read what it may have missed while there was none. */
  onOpen: () => void
  environment?: RealtimeEnvironment
}

export type RealtimeClient = {
  start(): void
  stop(): void
  /** Tries again now instead of waiting, as when the tab comes back or the network returns. Does nothing while connected or stopped. */
  retryNow(): void
}

const browserEnvironment: RealtimeEnvironment = {
  connect: (url) => new WebSocket(url) as unknown as SocketLike,
  setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimer: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
  random: () => Math.random(),
}

/** The wait before attempt `attempt` (0 for the first): doubling up to a limit, with the wait spread randomly so many tabs do not return together. */
export function backoffDelay(attempt: number, random: number): number {
  const ceiling = Math.min(
    BACKOFF.maxDelayMs,
    BACKOFF.firstDelayMs * 2 ** attempt,
  )
  return Math.round(ceiling / 2 + (ceiling / 2) * random)
}

/**
 * One tab's connection to the realtime server. It reconnects by itself, with
 * growing waits, whenever the connection is lost or goes quiet, until it is
 * stopped or the server says the person is signed out. It trusts nothing it
 * is sent: a message that is not a valid event is ignored.
 */
export function createRealtimeClient(
  options: RealtimeClientOptions,
): RealtimeClient {
  const environment = options.environment ?? browserEnvironment
  let socket: SocketLike | undefined
  let attempt = 0
  let status: RealtimeStatus = RealtimeStatus.Stopped
  let retryTimer: TimerHandle | undefined
  let stableTimer: TimerHandle | undefined
  let silenceTimer: TimerHandle | undefined
  let running = false

  function setStatus(next: RealtimeStatus): void {
    if (status === next) return
    status = next
    options.onStatus(next)
  }

  function clearTimers(): void {
    for (const timer of [retryTimer, stableTimer, silenceTimer]) {
      if (timer !== undefined) environment.clearTimer(timer)
    }
    retryTimer = undefined
    stableTimer = undefined
    silenceTimer = undefined
  }

  function watchForSilence(): void {
    if (silenceTimer !== undefined) environment.clearTimer(silenceTimer)
    silenceTimer = environment.setTimer(() => {
      socket?.close(CloseCode.GoingAway, 'No news from the server.')
    }, BACKOFF.silenceLimitMs)
  }

  function lose(): void {
    clearTimers()
    socket = undefined
    if (!running) return
    setStatus(RealtimeStatus.Reconnecting)
    retryTimer = environment.setTimer(
      connect,
      backoffDelay(attempt, environment.random()),
    )
    attempt += 1
  }

  function connect(): void {
    retryTimer = undefined
    let opened: SocketLike
    try {
      opened = environment.connect(options.url)
    } catch {
      running = false
      setStatus(RealtimeStatus.Stopped)
      return
    }
    socket = opened
    opened.onopen = () => {
      if (socket !== opened) return
      setStatus(RealtimeStatus.Open)
      stableTimer = environment.setTimer(() => {
        attempt = 0
      }, BACKOFF.stableAfterMs)
      watchForSilence()
      options.onOpen()
    }
    opened.onmessage = (message) => {
      if (socket !== opened || typeof message.data !== 'string') return
      const event = decodeEvent(message.data)
      if (event === undefined) return
      watchForSilence()
      options.onEvent(event)
    }
    opened.onclose = (event) => {
      if (socket !== opened) return
      if (event.code === CloseCode.SignedOut) {
        running = false
        clearTimers()
        socket = undefined
        setStatus(RealtimeStatus.Stopped)
        return
      }
      lose()
    }
    opened.onerror = () => undefined
  }

  return {
    start() {
      if (running) return
      running = true
      attempt = 0
      setStatus(RealtimeStatus.Connecting)
      connect()
    },
    stop() {
      running = false
      clearTimers()
      const closing = socket
      socket = undefined
      closing?.close(1000, 'Done.')
      setStatus(RealtimeStatus.Stopped)
    },
    retryNow() {
      if (!running || status === RealtimeStatus.Open) return
      if (retryTimer === undefined) return
      environment.clearTimer(retryTimer)
      connect()
    },
  }
}
