import { describe, expect, it } from 'vitest'

import {
  decodeEvent,
  encodeEvent,
  REALTIME_PROTOCOL_VERSION,
} from '@/features/realtime/realtime-events'
import type { RealtimeEvent } from '@/features/realtime/realtime-events'

const EVENTS: RealtimeEvent[] = [
  { type: 'documents.changed' },
  {
    type: 'document.updated',
    documentId: 'doc-1',
    revision: 4,
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  { type: 'document.deleted', documentId: 'doc-1' },
  { type: 'results.changed' },
  { type: 'workflows.changed' },
  { type: 'heartbeat' },
]

describe('realtime events', () => {
  it('survive being sent and read back', () => {
    for (const event of EVENTS) {
      expect(decodeEvent(encodeEvent(event))).toEqual(event)
    }
  })

  it('are sent with the protocol version', () => {
    expect(JSON.parse(encodeEvent({ type: 'heartbeat' }))).toEqual({
      v: REALTIME_PROTOCOL_VERSION,
      event: { type: 'heartbeat' },
    })
  })

  it('are ignored when they are not valid JSON', () => {
    expect(decodeEvent('not json')).toBeUndefined()
    expect(decodeEvent('')).toBeUndefined()
  })

  it('are ignored for another version of the protocol', () => {
    expect(
      decodeEvent(JSON.stringify({ v: 2, event: { type: 'heartbeat' } })),
    ).toBeUndefined()
  })

  it('are ignored when the kind is not known', () => {
    expect(
      decodeEvent(JSON.stringify({ v: 1, event: { type: 'explode' } })),
    ).toBeUndefined()
  })

  it('are ignored when a field is wrong or extra', () => {
    const updated = {
      type: 'document.updated',
      documentId: 'doc-1',
      revision: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    for (const bad of [
      { ...updated, revision: -1 },
      { ...updated, revision: 1.5 },
      { ...updated, documentId: '' },
      { ...updated, updatedAt: 'yesterday' },
      { ...updated, secret: 'x' },
      { type: 'heartbeat', extra: true },
    ]) {
      expect(decodeEvent(JSON.stringify({ v: 1, event: bad }))).toBeUndefined()
    }
  })

  it('are ignored when the message has more than a version and an event', () => {
    expect(
      decodeEvent(
        JSON.stringify({ v: 1, event: { type: 'heartbeat' }, more: 1 }),
      ),
    ).toBeUndefined()
  })
})
