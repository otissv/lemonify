import { CloseCode, encodeEvent } from '@/features/realtime/realtime-events'
import type { RealtimeEvent } from '@/features/realtime/realtime-events'
import type { Logger } from '../http/logger.ts'
import type { ChangePublisher } from './change-publisher.ts'

/** The part of a connection the hub needs, so it can be tested without a network. */
export interface RealtimeSocket {
  send(data: string): void
  close(code: number, reason: string): void
  /** Bytes accepted to send but not yet on the wire. */
  readonly bufferedAmount: number
}

export type HubLimits = {
  maxConnectionsPerUser: number
  maxConnections: number
  /** A connection with more than this waiting to be sent cannot keep up, and is dropped. */
  maxBufferedBytes: number
}

export type Attachment = {
  /** Takes the connection out of the hub; safe to call more than once. */
  detach(): void
}

export type AttachRefusal = 'user-full' | 'server-full'

const SLOW_CLIENT_REASON = 'This tab is not keeping up with updates.'

/**
 * The open connections, grouped by person. An event goes only to the
 * connections of the person it is for, so no one hears about another person's
 * work. It lives in this process, which is enough while one server process
 * serves the website; running several means swapping it for one backed by a
 * shared channel, behind the same `ChangePublisher`.
 */
export class RealtimeHub implements ChangePublisher {
  readonly #byUser = new Map<string, Set<RealtimeSocket>>()
  readonly #limits: HubLimits
  readonly #logger: Logger
  #total = 0

  constructor(limits: HubLimits, logger: Logger) {
    this.#limits = limits
    this.#logger = logger
  }

  get size(): number {
    return this.#total
  }

  /** How many connections a person has open. */
  connectionsOf(userId: string): number {
    return this.#byUser.get(userId)?.size ?? 0
  }

  /** Whether a new connection for this person would be accepted, and if not, why. */
  refusalFor(userId: string): AttachRefusal | undefined {
    if (this.#total >= this.#limits.maxConnections) return 'server-full'
    if (this.connectionsOf(userId) >= this.#limits.maxConnectionsPerUser) {
      return 'user-full'
    }
    return undefined
  }

  attach(userId: string, socket: RealtimeSocket): Attachment | AttachRefusal {
    const refusal = this.refusalFor(userId)
    if (refusal !== undefined) return refusal
    const sockets = this.#byUser.get(userId) ?? new Set<RealtimeSocket>()
    sockets.add(socket)
    this.#byUser.set(userId, sockets)
    this.#total += 1
    return { detach: () => this.#remove(userId, socket) }
  }

  #remove(userId: string, socket: RealtimeSocket): void {
    const sockets = this.#byUser.get(userId)
    if (!sockets?.delete(socket)) return
    this.#total -= 1
    if (sockets.size === 0) this.#byUser.delete(userId)
  }

  publish(userId: string, event: RealtimeEvent): void {
    const sockets = this.#byUser.get(userId)
    if (!sockets) return
    const message = encodeEvent(event)
    for (const socket of [...sockets]) this.#deliver(userId, socket, message)
  }

  #deliver(userId: string, socket: RealtimeSocket, message: string): void {
    try {
      if (socket.bufferedAmount > this.#limits.maxBufferedBytes) {
        this.#remove(userId, socket)
        socket.close(CloseCode.TryAgainLater, SLOW_CLIENT_REASON)
        return
      }
      socket.send(message)
    } catch (error) {
      this.#remove(userId, socket)
      this.#logger.warn('A realtime connection could not be written to', {
        userId,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Sends an event to every connection of every person, as the heartbeat does. */
  broadcast(event: RealtimeEvent): void {
    const message = encodeEvent(event)
    for (const [userId, sockets] of [...this.#byUser]) {
      for (const socket of [...sockets]) this.#deliver(userId, socket, message)
    }
  }

  /** Closes every connection of one person, as when their sign-in ends. */
  closeUser(userId: string, code: number, reason: string): void {
    for (const socket of [...(this.#byUser.get(userId) ?? [])]) {
      this.#remove(userId, socket)
      this.#closeQuietly(socket, code, reason)
    }
  }

  closeAll(code: number, reason: string): void {
    for (const [userId, sockets] of [...this.#byUser]) {
      for (const socket of [...sockets]) {
        this.#remove(userId, socket)
        this.#closeQuietly(socket, code, reason)
      }
    }
  }

  #closeQuietly(socket: RealtimeSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason)
    } catch {
      // The connection was already gone; nothing is left to close.
    }
  }
}
