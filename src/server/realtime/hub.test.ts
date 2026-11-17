import { describe, expect, it, vi } from 'vitest'

import { decodeEvent } from '@/features/realtime/realtime-events'
import type { Logger } from '../http/logger.ts'
import { RealtimeHub } from './hub.ts'
import type { HubLimits, RealtimeSocket } from './hub.ts'

const LIMITS: HubLimits = {
  maxConnectionsPerUser: 2,
  maxConnections: 3,
  maxBufferedBytes: 1000,
}

function silentLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

class FakeSocket implements RealtimeSocket {
  sent: string[] = []
  closed: { code: number; reason: string } | undefined
  bufferedAmount = 0
  failWith: Error | undefined

  send(data: string): void {
    if (this.failWith) throw this.failWith
    this.sent.push(data)
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason }
  }

  events(): unknown[] {
    return this.sent.map((text) => decodeEvent(text))
  }
}

function makeHub(limits = LIMITS): { hub: RealtimeHub; logger: Logger } {
  const logger = silentLogger()
  return { hub: new RealtimeHub(limits, logger), logger }
}

describe('RealtimeHub', () => {
  it('sends an event to every connection of the person it is for', () => {
    const { hub } = makeHub()
    const first = new FakeSocket()
    const second = new FakeSocket()
    hub.attach('ann', first)
    hub.attach('ann', second)

    hub.publish('ann', { type: 'documents.changed' })

    expect(first.events()).toEqual([{ type: 'documents.changed' }])
    expect(second.events()).toEqual([{ type: 'documents.changed' }])
  })

  it('never sends one person’s event to another person', () => {
    const { hub } = makeHub()
    const ann = new FakeSocket()
    const bea = new FakeSocket()
    hub.attach('ann', ann)
    hub.attach('bea', bea)

    hub.publish('ann', { type: 'results.changed' })

    expect(bea.sent).toEqual([])
  })

  it('sends a broadcast to everyone', () => {
    const { hub } = makeHub()
    const ann = new FakeSocket()
    const bea = new FakeSocket()
    hub.attach('ann', ann)
    hub.attach('bea', bea)

    hub.broadcast({ type: 'heartbeat' })

    expect(ann.events()).toEqual([{ type: 'heartbeat' }])
    expect(bea.events()).toEqual([{ type: 'heartbeat' }])
  })

  it('does nothing for a person with no connection', () => {
    const { hub } = makeHub()

    expect(() => hub.publish('nobody', { type: 'heartbeat' })).not.toThrow()
  })

  it('stops sending to a connection that was detached', () => {
    const { hub } = makeHub()
    const socket = new FakeSocket()
    const attached = hub.attach('ann', socket)
    if (typeof attached === 'string') throw new Error('refused')

    attached.detach()
    attached.detach()
    hub.publish('ann', { type: 'heartbeat' })

    expect(socket.sent).toEqual([])
    expect(hub.size).toBe(0)
    expect(hub.connectionsOf('ann')).toBe(0)
  })

  it('counts connections in total and per person', () => {
    const { hub } = makeHub()
    hub.attach('ann', new FakeSocket())
    hub.attach('ann', new FakeSocket())
    hub.attach('bea', new FakeSocket())

    expect(hub.size).toBe(3)
    expect(hub.connectionsOf('ann')).toBe(2)
    expect(hub.connectionsOf('bea')).toBe(1)
  })

  it('refuses a person more connections than the limit, without closing the ones they have', () => {
    const { hub } = makeHub()
    const first = new FakeSocket()
    hub.attach('ann', first)
    hub.attach('ann', new FakeSocket())

    expect(hub.attach('ann', new FakeSocket())).toBe('user-full')
    expect(hub.refusalFor('ann')).toBe('user-full')
    expect(first.closed).toBeUndefined()
    expect(hub.attach('bea', new FakeSocket())).not.toBe('user-full')
  })

  it('refuses any connection once the server has as many as it allows', () => {
    const { hub } = makeHub()
    hub.attach('ann', new FakeSocket())
    hub.attach('bea', new FakeSocket())
    hub.attach('cat', new FakeSocket())

    expect(hub.attach('dan', new FakeSocket())).toBe('server-full')
  })

  it('takes a connection again once another has gone', () => {
    const { hub } = makeHub()
    const first = hub.attach('ann', new FakeSocket())
    hub.attach('ann', new FakeSocket())
    if (typeof first === 'string') throw new Error('refused')

    first.detach()

    expect(hub.refusalFor('ann')).toBeUndefined()
  })

  it('drops a connection that cannot keep up, and tells it to try again later', () => {
    const { hub } = makeHub()
    const slow = new FakeSocket()
    const quick = new FakeSocket()
    hub.attach('ann', slow)
    hub.attach('ann', quick)
    slow.bufferedAmount = 5000

    hub.publish('ann', { type: 'documents.changed' })

    expect(slow.sent).toEqual([])
    expect(slow.closed?.code).toBe(1013)
    expect(quick.events()).toEqual([{ type: 'documents.changed' }])
    expect(hub.connectionsOf('ann')).toBe(1)
  })

  it('drops a connection that fails when written to, and keeps sending to the rest', () => {
    const { hub, logger } = makeHub()
    const broken = new FakeSocket()
    const fine = new FakeSocket()
    broken.failWith = new Error('socket is closed')
    hub.attach('ann', broken)
    hub.attach('ann', fine)

    hub.publish('ann', { type: 'results.changed' })

    expect(fine.events()).toEqual([{ type: 'results.changed' }])
    expect(hub.connectionsOf('ann')).toBe(1)
    expect(logger.warn).toHaveBeenCalledWith(
      'A realtime connection could not be written to',
      { userId: 'ann', detail: 'socket is closed' },
    )
  })

  it('closes one person’s connections when their sign-in ends', () => {
    const { hub } = makeHub()
    const ann = new FakeSocket()
    const bea = new FakeSocket()
    hub.attach('ann', ann)
    hub.attach('bea', bea)

    hub.closeUser('ann', 4401, 'Signed out.')

    expect(ann.closed).toEqual({ code: 4401, reason: 'Signed out.' })
    expect(bea.closed).toBeUndefined()
    expect(hub.size).toBe(1)
  })

  it('closes every connection when the server stops', () => {
    const { hub } = makeHub()
    const ann = new FakeSocket()
    const bea = new FakeSocket()
    hub.attach('ann', ann)
    hub.attach('bea', bea)

    hub.closeAll(1001, 'Going away.')

    expect(ann.closed?.code).toBe(1001)
    expect(bea.closed?.code).toBe(1001)
    expect(hub.size).toBe(0)
  })

  it('carries on closing when one connection cannot be closed', () => {
    const { hub } = makeHub()
    const stuck = new FakeSocket()
    stuck.close = () => {
      throw new Error('already closed')
    }
    const other = new FakeSocket()
    hub.attach('ann', stuck)
    hub.attach('ann', other)

    expect(() => hub.closeAll(1001, 'Going away.')).not.toThrow()
    expect(other.closed?.code).toBe(1001)
  })
})
