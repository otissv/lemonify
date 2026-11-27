import { createConnection } from 'node:net'

/** A socket that takes longer than this to answer is not a web server at work. */
const PROBE_TIMEOUT_MS = 1000
const NOT_LISTENING = new Set(['ECONNREFUSED', 'ENOENT'])

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('code' in error)) return undefined
  return String(error.code)
}

/**
 * Whether a web server is running on the data folder whose socket this is:
 * the socket answers (decision 6, CLI). No socket, or one left by a server
 * that was killed, is no server. Any other failure (the socket cannot be
 * opened at all) is thrown, as it means something is wrong with the folder.
 */
export function webServerAnswers(
  socketPath: string,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = createConnection({ path: socketPath })
    const timer = setTimeout(() => {
      probe.destroy()
      resolve(false)
    }, timeoutMs)
    probe.once('connect', () => {
      clearTimeout(timer)
      probe.destroy()
      resolve(true)
    })
    probe.once('error', (error) => {
      clearTimeout(timer)
      probe.destroy()
      if (NOT_LISTENING.has(errorCode(error) ?? '')) resolve(false)
      else reject(error)
    })
  })
}
