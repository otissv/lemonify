import { chmod, lstat, mkdir, rm, stat } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import type { Server, Socket } from 'node:net'
import path from 'node:path'

import type { RealtimeEvent } from '@/features/realtime/realtime-events'
import type { Logger } from '../http/logger.ts'
import {
  decodeChannelMessage,
  MAX_CHANNEL_LINE_BYTES,
} from './channel-message.ts'

/** Only the user who runs Lemonify may open the socket, or the folder it is in. */
const SOCKET_MODE = 0o600
const DIRECTORY_MODE = 0o700
/** Enough for every worker and many CLI commands at once. */
const MAX_CONNECTIONS = 512
const NEWLINE = '\n'
const NOT_LISTENING = new Set(['ECONNREFUSED', 'ENOENT'])

export type ChannelServerDeps = {
  socketPath: string
  logger: Logger
  /** Called for every change another process sends; the web server passes it to the open tabs. */
  onChange(userId: string, event: RealtimeEvent): void
}

export type ChannelServer = {
  /** Stops listening, closes every connection and removes the socket. */
  close(): Promise<void>
}

/** Another web server already listens on the socket, so this one would steal its changes. */
export class ChannelInUseError extends Error {
  constructor(socketPath: string) {
    super(
      `Another Lemonify web server is already running on this data folder (${socketPath}). Stop it, or give this one its own LEMONIFY_DATA_DIR.`,
    )
    this.name = 'ChannelInUseError'
  }
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('code' in error)) return undefined
  return String(error.code)
}

/** A folder only this user can enter, which it must own, so no one else can reach the socket in it. */
async function prepareDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE })
  const owner = (await stat(directory)).uid
  const uid = process.getuid?.()
  if (uid !== undefined && owner !== uid) {
    throw new Error(
      `The socket folder ${directory} belongs to another user, so the web server will not listen in it.`,
    )
  }
  await chmod(directory, DIRECTORY_MODE)
}

function answers(socketPath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = createConnection({ path: socketPath })
    probe.once('connect', () => {
      probe.destroy()
      resolve(true)
    })
    probe.once('error', (error) => {
      if (NOT_LISTENING.has(errorCode(error) ?? '')) resolve(false)
      else reject(error)
    })
  })
}

/** Removes a socket that nothing listens on any more, as a killed web server leaves. */
async function clearStaleSocket(socketPath: string): Promise<void> {
  let found: Awaited<ReturnType<typeof lstat>>
  try {
    found = await lstat(socketPath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return
    throw error
  }
  if (!found.isSocket()) {
    throw new Error(
      `${socketPath} is not a socket, so the web server will not replace it. Move it away and start again.`,
    )
  }
  if (await answers(socketPath)) throw new ChannelInUseError(socketPath)
  await rm(socketPath, { force: true })
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', (error) => {
      reject(
        errorCode(error) === 'EADDRINUSE'
          ? new ChannelInUseError(socketPath)
          : error,
      )
    })
    server.listen(socketPath, () => resolve())
  })
}

/** Reads one connection's lines and passes on each change in them. */
function readChanges(socket: Socket, deps: ChannelServerDeps): void {
  let pending = ''
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    pending += chunk
    let end = pending.indexOf(NEWLINE)
    while (end !== -1) {
      deliver(pending.slice(0, end), deps)
      pending = pending.slice(end + 1)
      end = pending.indexOf(NEWLINE)
    }
    if (Buffer.byteLength(pending) > MAX_CHANNEL_LINE_BYTES) {
      deps.logger.warn(
        'A process sent a line longer than any change; its connection was closed',
      )
      socket.destroy()
    }
  })
  // A process that stops mid-write resets its connection; nothing is lost but its unfinished line.
  socket.on('error', () => socket.destroy())
}

function deliver(line: string, deps: ChannelServerDeps): void {
  if (line === '') return
  const change =
    Buffer.byteLength(line) > MAX_CHANNEL_LINE_BYTES
      ? undefined
      : decodeChannelMessage(line)
  if (change === undefined) {
    deps.logger.warn(
      'A process sent a change the web server does not take; it was dropped',
    )
    return
  }
  try {
    deps.onChange(change.userId, change.event)
  } catch (error) {
    deps.logger.error('A change from another process could not be passed on', {
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Listens on the local socket that every other process (workers, CLI
 * commands) sends its changes to (decision 4, live updates). Each line is one
 * change for one person's tabs, checked by the channel message schema; what
 * fails it is logged and dropped. Only the user who runs Lemonify can reach
 * the socket, as its folder is theirs alone.
 */
export async function startChannelServer(
  deps: ChannelServerDeps,
): Promise<ChannelServer> {
  const { socketPath } = deps
  await prepareDirectory(path.dirname(socketPath))
  await clearStaleSocket(socketPath)
  const connections = new Set<Socket>()
  const server = createServer((socket) => {
    connections.add(socket)
    socket.once('close', () => connections.delete(socket))
    readChanges(socket, deps)
  })
  server.maxConnections = MAX_CONNECTIONS
  await listen(server, socketPath)
  await chmod(socketPath, SOCKET_MODE)
  let closing: Promise<void> | undefined
  const close = async (): Promise<void> => {
    const stopped = new Promise<void>((resolve) =>
      server.close(() => resolve()),
    )
    for (const socket of connections) socket.destroy()
    await stopped
    await rm(socketPath, { force: true })
  }
  return {
    close() {
      closing ??= close()
      return closing
    },
  }
}
