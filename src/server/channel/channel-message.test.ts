import { describe, expect, it } from 'vitest'

import { WorkerPool } from '@/features/ai/ai-tools'

import {
  CHANNEL_PROTOCOL_VERSION,
  decodeChannelMessage,
  encodeChannelChange,
  encodeChannelQueued,
} from './channel-message'

const CHANGE = {
  type: 'change',
  userId: 'ann',
  event: { type: 'document.deleted', documentId: 'doc-1' },
} as const

const V = CHANNEL_PROTOCOL_VERSION

describe('a channel message', () => {
  it('is one line of JSON that reads back as the change it carries', () => {
    const line = encodeChannelChange(CHANGE.userId, CHANGE.event)
    expect(line.endsWith('\n')).toBe(true)
    expect(line.slice(0, -1)).not.toContain('\n')
    expect(decodeChannelMessage(line.slice(0, -1))).toEqual(CHANGE)
  })

  it('says which pools a process queued jobs for, so the web server can wake their workers', () => {
    const line = encodeChannelQueued([WorkerPool.Cpu, WorkerPool.Gpu])
    expect(line.endsWith('\n')).toBe(true)
    expect(decodeChannelMessage(line.slice(0, -1))).toEqual({
      type: 'queued',
      pools: [WorkerPool.Cpu, WorkerPool.Gpu],
    })
  })

  it.each([
    ['text that is not JSON', 'not json'],
    ['another protocol version', JSON.stringify({ ...CHANGE, v: V + 1 })],
    [
      'of no kind',
      JSON.stringify({ v: V, userId: 'ann', event: CHANGE.event }),
    ],
    [
      'of a kind it does not know',
      JSON.stringify({ ...CHANGE, v: V, type: 'stop' }),
    ],
    [
      'a change for no user',
      JSON.stringify({ v: V, type: 'change', event: CHANGE.event }),
    ],
    [
      'a change for an empty user',
      JSON.stringify({ ...CHANGE, v: V, userId: '' }),
    ],
    [
      'an event tabs do not know',
      JSON.stringify({ ...CHANGE, v: V, event: { type: 'document.stolen' } }),
    ],
    [
      'an event with content',
      JSON.stringify({
        ...CHANGE,
        v: V,
        event: { ...CHANGE.event, name: 'secret' },
      }),
    ],
    [
      'a field the format does not have',
      JSON.stringify({ ...CHANGE, v: V, extra: 1 }),
    ],
    [
      'a heartbeat, which only the web server sends',
      JSON.stringify({ ...CHANGE, v: V, event: { type: 'heartbeat' } }),
    ],
    ['queued for no pool', JSON.stringify({ v: V, type: 'queued', pools: [] })],
    [
      'queued for a pool there is not',
      JSON.stringify({ v: V, type: 'queued', pools: ['tpu'] }),
    ],
    [
      'queued for a pool twice',
      JSON.stringify({ v: V, type: 'queued', pools: ['cpu', 'cpu'] }),
    ],
  ])('is refused when it is %s', (_case, line) => {
    expect(decodeChannelMessage(line)).toBeUndefined()
  })
})
