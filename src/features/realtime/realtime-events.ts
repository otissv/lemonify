import { z } from 'zod'

/** Bumped when a message changes shape, so an old tab and a new server can tell. */
export const REALTIME_PROTOCOL_VERSION = 1

/** Where the realtime server listens, on its own port. */
export const REALTIME_PATH = '/realtime'

const id = z.string().min(1).max(200)

/**
 * What the server tells a person's open tabs. An event says only that
 * something changed and which thing: never its content. A tab reads the
 * content through the same checked requests as any other read, so an event on
 * its own gives away nothing.
 */
export const RealtimeEventSchema = z.discriminatedUnion('type', [
  /** A document was made, removed, renamed, moved in the list or had its image changed: the list is out of date. */
  z.strictObject({ type: z.literal('documents.changed') }),
  /** A document's content or name is now at this revision. */
  z.strictObject({
    type: z.literal('document.updated'),
    documentId: id,
    revision: z.number().int().nonnegative(),
    updatedAt: z.iso.datetime(),
  }),
  z.strictObject({ type: z.literal('document.deleted'), documentId: id }),
  /** An AI result or an export was made or removed. */
  z.strictObject({ type: z.literal('results.changed') }),
  /** A workflow's content or name is now at this revision. */
  z.strictObject({
    type: z.literal('workflow.updated'),
    workflowId: id,
    revision: z.number().int().nonnegative(),
    updatedAt: z.iso.datetime(),
  }),
  z.strictObject({ type: z.literal('workflow.deleted'), workflowId: id }),
  /** A workflow was made, removed or renamed, or one of its runs changed: the lists are out of date. */
  z.strictObject({ type: z.literal('workflows.changed') }),
  /** A document or workflow that this one's layers use, at any depth, changed: its picture is out of date. */
  z.strictObject({ type: z.literal('picture.changed'), itemId: id }),
  /** The person's key bindings were saved or reset. */
  z.strictObject({ type: z.literal('keybindings.changed') }),
  /** Sent now and then, so a tab can tell a quiet connection from a dead one. */
  z.strictObject({ type: z.literal('heartbeat') }),
])

export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>

export const RealtimeMessageSchema = z.strictObject({
  v: z.literal(REALTIME_PROTOCOL_VERSION),
  event: RealtimeEventSchema,
})

export type RealtimeMessage = z.infer<typeof RealtimeMessageSchema>

export function encodeEvent(event: RealtimeEvent): string {
  return JSON.stringify({
    v: REALTIME_PROTOCOL_VERSION,
    event,
  } satisfies RealtimeMessage)
}

/** The event in a message from the server, or undefined when it is not one this tab understands. */
export function decodeEvent(text: string): RealtimeEvent | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  const parsed = RealtimeMessageSchema.safeParse(value)
  return parsed.success ? parsed.data.event : undefined
}

/**
 * Why a connection was closed, where the browser can read it. The 4000s are
 * this app's own.
 */
export const CloseCode = {
  /** The server is shutting down; reconnect. */
  GoingAway: 1001,
  /** The client sent something this channel does not take. */
  PolicyViolation: 1008,
  /** The client cannot keep up. */
  TryAgainLater: 1013,
  /** The sign-in ended; do not reconnect until signed in again. */
  SignedOut: 4401,
} as const
