import { beforeEach, describe, expect, it } from 'vitest'

import {
  BACKOFF,
  RealtimeStatus,
  backoffDelay,
  createRealtimeClient,
} from '@/features/realtime/realtime-client'
import type {
  RealtimeEnvironment,
  SocketLike,
} from '@/features/realtime/realtime-client'
import { encodeEvent } from '@/features/realtime/realtime-events'
import type { RealtimeEvent } from '@/features/realtime/realtime-events'

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  closedWith: { code?: number; reason?: string } | undefined

  constructor(readonly url: string) {}

  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason }
  }

  open(): void {
    this.onopen?.()
  }

  receive(data: unknown): void {
    this.onmessage?.({ data })
  }

  drop(code = 1006): void {
    this.onclose?.({ code })
  }
}

type Timer = { callback: () => void; at: number; id: number }

class FakeEnvironment implements RealtimeEnvironment {
  sockets: FakeSocket[] = []
  timers: Timer[] = []
  now = 0
  nextRandom = 1
  failToConnect = false
  #id = 0

  connect = (url: string): SocketLike => {
    if (this.failToConnect) throw new Error('bad url')
    const socket = new FakeSocket(url)
    this.sockets.push(socket)
    return socket
  }

  setTimer = (callback: () => void, milliseconds: number): number => {
    this.#id += 1
    this.timers.push({ callback, at: this.now + milliseconds, id: this.#id })
    return this.#id
  }

  clearTimer = (handle: unknown): void => {
    this.timers = this.timers.filter((timer) => timer.id !== handle)
  }

  random = (): number => this.nextRandom

  get last(): FakeSocket {
    const socket = this.sockets.at(-1)
    if (!socket) throw new Error('no socket yet')
    return socket
  }

  advance(milliseconds: number): void {
    const until = this.now + milliseconds
    for (;;) {
      const due = this.timers
        .filter((timer) => timer.at <= until)
        .sort((a, b) => a.at - b.at)[0]
      if (!due) break
      this.now = due.at
      this.timers = this.timers.filter((timer) => timer.id !== due.id)
      due.callback()
    }
    this.now = until
  }
}

let environment: FakeEnvironment
let events: RealtimeEvent[]
let statuses: RealtimeStatus[]
let opens: number

function make() {
  return createRealtimeClient({
    url: 'ws://localhost:3101/realtime',
    onEvent: (event) => events.push(event),
    onStatus: (status) => statuses.push(status),
    onOpen: () => {
      opens += 1
    },
    environment,
  })
}

beforeEach(() => {
  environment = new FakeEnvironment()
  events = []
  statuses = []
  opens = 0
})

describe('backoffDelay', () => {
  it('doubles each time, up to a limit', () => {
    expect(backoffDelay(0, 1)).toBe(1000)
    expect(backoffDelay(1, 1)).toBe(2000)
    expect(backoffDelay(2, 1)).toBe(4000)
    expect(backoffDelay(10, 1)).toBe(BACKOFF.maxDelayMs)
  })

  it('spreads the wait over its upper half, so many tabs do not return together', () => {
    expect(backoffDelay(2, 0)).toBe(2000)
    expect(backoffDelay(2, 0.5)).toBe(3000)
    expect(backoffDelay(2, 1)).toBe(4000)
  })
})

describe('createRealtimeClient', () => {
  it('connects to the address it was given and says it is connecting, then open', () => {
    const client = make()

    client.start()
    expect(environment.last.url).toBe('ws://localhost:3101/realtime')
    expect(statuses).toEqual([RealtimeStatus.Connecting])

    environment.last.open()
    expect(statuses).toEqual([RealtimeStatus.Connecting, RealtimeStatus.Open])
    expect(opens).toBe(1)
  })

  it('hands on the events it is sent', () => {
    const client = make()
    client.start()
    environment.last.open()

    environment.last.receive(encodeEvent({ type: 'documents.changed' }))
    environment.last.receive(
      encodeEvent({ type: 'document.deleted', documentId: 'd1' }),
    )

    expect(events).toEqual([
      { type: 'documents.changed' },
      { type: 'document.deleted', documentId: 'd1' },
    ])
  })

  it('ignores anything that is not a valid event', () => {
    const client = make()
    client.start()
    environment.last.open()

    environment.last.receive('not json')
    environment.last.receive(JSON.stringify({ v: 1, event: { type: 'boom' } }))
    environment.last.receive(new ArrayBuffer(4))
    environment.last.receive(null)

    expect(events).toEqual([])
  })

  it('does not start twice', () => {
    const client = make()

    client.start()
    client.start()

    expect(environment.sockets).toHaveLength(1)
  })

  describe('losing the connection', () => {
    it('tries again after a wait, and reads what it missed each time it opens', () => {
      const client = make()
      client.start()
      environment.last.open()

      environment.last.drop()
      expect(statuses.at(-1)).toBe(RealtimeStatus.Reconnecting)
      expect(environment.sockets).toHaveLength(1)

      environment.advance(1000)
      expect(environment.sockets).toHaveLength(2)
      environment.last.open()

      expect(statuses.at(-1)).toBe(RealtimeStatus.Open)
      expect(opens).toBe(2)
    })

    it('waits longer after each failure', () => {
      const client = make()
      client.start()

      environment.last.drop()
      environment.advance(1000)
      environment.last.drop()
      environment.advance(1999)
      expect(environment.sockets).toHaveLength(2)
      environment.advance(1)

      expect(environment.sockets).toHaveLength(3)
    })

    it('starts the waits again once a connection has stayed open', () => {
      const client = make()
      client.start()
      environment.last.drop()
      environment.advance(1000)
      environment.last.drop()
      environment.advance(2000)
      environment.last.open()
      environment.advance(BACKOFF.stableAfterMs)
      environment.last.drop()

      environment.advance(1000)

      expect(environment.sockets).toHaveLength(4)
    })

    it('does not start the waits again for a connection that closes at once', () => {
      const client = make()
      client.start()
      environment.last.drop()
      environment.advance(1000)
      environment.last.open()
      environment.last.drop(1013)

      environment.advance(1999)
      expect(environment.sockets).toHaveLength(2)
      environment.advance(1)

      expect(environment.sockets).toHaveLength(3)
    })

    it('treats a connection that goes quiet as lost', () => {
      const client = make()
      client.start()
      const quiet = environment.last
      quiet.open()

      environment.advance(BACKOFF.silenceLimitMs)

      expect(quiet.closedWith?.code).toBe(1001)
    })

    it('does not treat a connection as quiet while it keeps hearing from the server', () => {
      const client = make()
      client.start()
      const live = environment.last
      live.open()

      for (let beat = 0; beat < 5; beat += 1) {
        environment.advance(BACKOFF.silenceLimitMs - 1000)
        live.receive(encodeEvent({ type: 'heartbeat' }))
      }

      expect(live.closedWith).toBeUndefined()
    })

    it('ignores what an old connection says once it has been replaced', () => {
      const client = make()
      client.start()
      const old = environment.last
      old.open()
      old.drop()
      environment.advance(1000)
      environment.last.open()

      old.receive(encodeEvent({ type: 'documents.changed' }))
      old.drop()

      expect(events).toEqual([])
      expect(environment.sockets).toHaveLength(2)
      expect(statuses.at(-1)).toBe(RealtimeStatus.Open)
    })

    it('tries now when asked, instead of waiting', () => {
      const client = make()
      client.start()
      environment.last.drop()

      client.retryNow()

      expect(environment.sockets).toHaveLength(2)
    })

    it('does not try again while connected', () => {
      const client = make()
      client.start()
      environment.last.open()

      client.retryNow()

      expect(environment.sockets).toHaveLength(1)
    })
  })

  describe('being signed out', () => {
    it('stops for good when the server says the sign-in ended', () => {
      const client = make()
      client.start()
      environment.last.open()

      environment.last.drop(4401)
      environment.advance(60_000)

      expect(statuses.at(-1)).toBe(RealtimeStatus.Stopped)
      expect(environment.sockets).toHaveLength(1)
    })
  })

  describe('stopping', () => {
    it('closes the connection and does not try again', () => {
      const client = make()
      client.start()
      const live = environment.last
      live.open()

      client.stop()
      live.drop(1000)
      environment.advance(60_000)

      expect(live.closedWith?.code).toBe(1000)
      expect(statuses.at(-1)).toBe(RealtimeStatus.Stopped)
      expect(environment.sockets).toHaveLength(1)
    })

    it('does not try again after being stopped while waiting', () => {
      const client = make()
      client.start()
      environment.last.drop()

      client.stop()
      environment.advance(60_000)

      expect(environment.sockets).toHaveLength(1)
    })

    it('can be started again', () => {
      const client = make()
      client.start()
      client.stop()

      client.start()

      expect(environment.sockets).toHaveLength(2)
      expect(statuses.at(-1)).toBe(RealtimeStatus.Connecting)
    })
  })

  it('stops when it cannot even make a connection', () => {
    environment.failToConnect = true
    const client = make()

    client.start()

    expect(statuses.at(-1)).toBe(RealtimeStatus.Stopped)
    expect(environment.timers).toHaveLength(0)
  })
})
