import { z } from 'zod'

import { WorkerPool } from '@/features/ai/ai-tools'
import { RealtimeEventSchema } from '@/features/realtime/realtime-events'
import type { RealtimeEvent } from '@/features/realtime/realtime-events'

/** Bumped when a message changes shape, so processes of two versions can tell. */
export const CHANNEL_PROTOCOL_VERSION = 1

/** The longest line a process may send; a message is a few hundred bytes. */
export const MAX_CHANNEL_LINE_BYTES = 16 * 1024

const HEARTBEAT = 'heartbeat'
const POOL_COUNT = Object.values(WorkerPool).length

/**
 * What another process tells the web server, one JSON line each:
 *
 * - `change`: something a person can see changed. It carries the same event
 *   the person's tabs are sent, so it names the thing that changed and never
 *   its content. A heartbeat is the web server's own and is never sent here.
 * - `queued`: the process queued jobs of these pools for the web server's
 *   workers (decision 6, CLI), so they start on them now rather than at their
 *   next look at the queue. It names no job and no person.
 */
const ChannelMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    v: z.literal(CHANNEL_PROTOCOL_VERSION),
    type: z.literal('change'),
    userId: z.string().min(1).max(200),
    event: RealtimeEventSchema.refine((event) => event.type !== HEARTBEAT, {
      message: 'A heartbeat is not a change.',
    }),
  }),
  z.strictObject({
    v: z.literal(CHANNEL_PROTOCOL_VERSION),
    type: z.literal('queued'),
    pools: z
      .array(z.enum(WorkerPool))
      .min(1)
      .max(POOL_COUNT)
      .refine((pools) => new Set(pools).size === pools.length, {
        message: 'A pool is named once.',
      }),
  }),
])

type WithoutVersion<T> = T extends unknown ? Omit<T, 'v'> : never

export type ChannelMessage = WithoutVersion<
  z.infer<typeof ChannelMessageSchema>
>

/** A change as one line, ending in a newline, ready to write to the socket. */
export function encodeChannelChange(
  userId: string,
  event: RealtimeEvent,
): string {
  return `${JSON.stringify({ v: CHANNEL_PROTOCOL_VERSION, type: 'change', userId, event })}\n`
}

/** That jobs of these pools were queued, as one line ending in a newline. */
export function encodeChannelQueued(pools: Iterable<WorkerPool>): string {
  return `${JSON.stringify({ v: CHANNEL_PROTOCOL_VERSION, type: 'queued', pools: [...new Set(pools)] })}\n`
}

/** The message in one line (without its newline), or undefined when it is not one of this format. */
export function decodeChannelMessage(line: string): ChannelMessage | undefined {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  const parsed = ChannelMessageSchema.safeParse(value)
  if (!parsed.success) return undefined
  const { v: _version, ...message } = parsed.data
  return message
}
