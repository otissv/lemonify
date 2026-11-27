import { z } from 'zod'

import { RealtimeEventSchema } from '@/features/realtime/realtime-events'
import type { RealtimeEvent } from '@/features/realtime/realtime-events'

/** Bumped when a message changes shape, so processes of two versions can tell. */
export const CHANNEL_PROTOCOL_VERSION = 1

/** The longest line a process may send; a change is a few hundred bytes. */
export const MAX_CHANNEL_LINE_BYTES = 16 * 1024

const HEARTBEAT = 'heartbeat'

/**
 * What another process tells the web server: that something a person can see
 * changed. It carries the same event the person's tabs are sent, so it names
 * the thing that changed and never its content. A heartbeat is the web
 * server's own and is never sent here.
 */
const ChannelMessageSchema = z.strictObject({
  v: z.literal(CHANNEL_PROTOCOL_VERSION),
  userId: z.string().min(1).max(200),
  event: RealtimeEventSchema.refine((event) => event.type !== HEARTBEAT, {
    message: 'A heartbeat is not a change.',
  }),
})

export type ChannelChange = Omit<z.infer<typeof ChannelMessageSchema>, 'v'>

/** The message as one line, ending in a newline, ready to write to the socket. */
export function encodeChannelMessage(
  userId: string,
  event: RealtimeEvent,
): string {
  return `${JSON.stringify({ v: CHANNEL_PROTOCOL_VERSION, userId, event })}\n`
}

/** The change in one line (without its newline), or undefined when it is not a message of this format. */
export function decodeChannelMessage(line: string): ChannelChange | undefined {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  const parsed = ChannelMessageSchema.safeParse(value)
  if (!parsed.success) return undefined
  return { userId: parsed.data.userId, event: parsed.data.event }
}
