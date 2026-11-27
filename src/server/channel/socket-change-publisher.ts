import { createConnection } from 'node:net'
import type { Socket } from 'node:net'

import type { RealtimeEvent } from '@/features/realtime/realtime-events'
import type { Logger } from '../http/logger.ts'
import type { ChangePublisher } from '../realtime/change-publisher.ts'
import { encodeChannelMessage } from './channel-message.ts'

const DEFAULT_MAX_PENDING_BYTES = 1024 * 1024
/** How long closing waits for the last changes to be written before it gives up on them. */
const DEFAULT_CLOSE_TIMEOUT_MS = 1000

export type SocketChangePublisherOptions = {
  /** Changes waiting to be written beyond this are dropped, so a stuck web server never grows this process. */
  maxPendingBytes?: number
  closeTimeoutMs?: number
}

/**
 * How a process that is not the web server (a worker, a CLI command) tells
 * open tabs what changed: it writes each change to the web server's socket
 * (decision 4, live updates; decision 7, CLI and website). Publishing never
 * waits and never throws. With no web server running there are no tabs, the
 * connection fails at once, and the change is dropped without a word. A lost
 * connection is opened again by the next change, so a restarted web server
 * hears from this process again.
 */
export class SocketChangePublisher implements ChangePublisher {
  readonly #socketPath: string
  readonly #logger: Logger
  readonly #maxPendingBytes: number
  readonly #closeTimeoutMs: number
  #socket: Socket | undefined
  #closed = false
  #warned = false

  constructor(
    socketPath: string,
    logger: Logger,
    options: SocketChangePublisherOptions = {},
  ) {
    this.#socketPath = socketPath
    this.#logger = logger
    this.#maxPendingBytes = options.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES
    this.#closeTimeoutMs = options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS
  }

  publish(userId: string, event: RealtimeEvent): void {
    if (this.#closed) return
    const socket = this.#connection()
    if (socket.writableLength > this.#maxPendingBytes) {
      this.#warnOnce()
      return
    }
    socket.write(encodeChannelMessage(userId, event))
  }

  /** Writes what is still waiting, then closes the connection; a command calls it before it ends. */
  async close(): Promise<void> {
    this.#closed = true
    const socket = this.#socket
    this.#socket = undefined
    if (socket === undefined || socket.destroyed) return
    socket.ref()
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        socket.destroy()
        resolve()
      }, this.#closeTimeoutMs)
      socket.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
      socket.end()
    })
  }

  #connection(): Socket {
    const current = this.#socket
    if (current !== undefined && !current.destroyed) return current
    const socket = createConnection({ path: this.#socketPath })
    // Waiting to tell tabs must never keep a finished process alive.
    socket.unref()
    // No web server is running, or it stopped: there are no tabs to tell.
    socket.on('error', () => socket.destroy())
    socket.once('close', () => {
      if (this.#socket === socket) this.#socket = undefined
    })
    this.#socket = socket
    return socket
  }

  #warnOnce(): void {
    if (this.#warned) return
    this.#warned = true
    this.#logger.warn(
      'The web server is not reading changes fast enough; some were not sent to open tabs',
      { socket: this.#socketPath },
    )
  }
}
