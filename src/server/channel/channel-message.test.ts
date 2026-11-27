import { describe, expect, it } from 'vitest'

import {
  CHANNEL_PROTOCOL_VERSION,
  decodeChannelMessage,
  encodeChannelMessage,
} from './channel-message'

const CHANGE = {
  userId: 'ann',
  event: { type: 'document.deleted', documentId: 'doc-1' },
} as const

describe('a channel message', () => {
  it('is one line of JSON that reads back as the change it carries', () => {
    const line = encodeChannelMessage(CHANGE.userId, CHANGE.event)
    expect(line.endsWith('\n')).toBe(true)
    expect(line.slice(0, -1)).not.toContain('\n')
    expect(decodeChannelMessage(line.slice(0, -1))).toEqual(CHANGE)
  })

  it.each([
    ['text that is not JSON', 'not json'],
    [
      'another protocol version',
      JSON.stringify({ v: CHANNEL_PROTOCOL_VERSION + 1, ...CHANGE }),
    ],
    [
      'no user',
      JSON.stringify({ v: CHANNEL_PROTOCOL_VERSION, event: CHANGE.event }),
    ],
    [
      'an empty user',
      JSON.stringify({
        v: CHANNEL_PROTOCOL_VERSION,
        userId: '',
        event: CHANGE.event,
      }),
    ],
    [
      'an event tabs do not know',
      JSON.stringify({
        v: CHANNEL_PROTOCOL_VERSION,
        userId: 'ann',
        event: { type: 'document.stolen' },
      }),
    ],
    [
      'an event with content',
      JSON.stringify({
        v: CHANNEL_PROTOCOL_VERSION,
        userId: 'ann',
        event: { ...CHANGE.event, name: 'secret' },
      }),
    ],
    [
      'a field the format does not have',
      JSON.stringify({ v: CHANNEL_PROTOCOL_VERSION, ...CHANGE, extra: 1 }),
    ],
    [
      'a heartbeat, which only the web server sends',
      JSON.stringify({
        v: CHANNEL_PROTOCOL_VERSION,
        userId: 'ann',
        event: { type: 'heartbeat' },
      }),
    ],
  ])('is refused when it is %s', (_case, line) => {
    expect(decodeChannelMessage(line)).toBeUndefined()
  })
})
