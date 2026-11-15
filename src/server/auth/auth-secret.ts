import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const SECRET_FILE = 'auth-secret'
const SECRET_BYTES = 32
const OWNER_ONLY = 0o600

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function isTaken(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

function readSecret(file: string): string | undefined {
  try {
    const secret = readFileSync(file, 'utf8').trim()
    return secret === '' ? undefined : secret
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

/**
 * The secret Better Auth signs sessions with. `LEMONIFY_AUTH_SECRET` wins;
 * otherwise one is created in the data directory on first use, readable by
 * its owner only, so a machine that only runs the CLI needs no set-up. The
 * file is created exclusively, so two processes starting together agree.
 */
export function resolveAuthSecret(
  configured: string | undefined,
  dataDir: string,
): string {
  if (configured !== undefined) return configured
  const file = path.join(dataDir, SECRET_FILE)
  const existing = readSecret(file)
  if (existing !== undefined) return existing

  mkdirSync(dataDir, { recursive: true })
  const created = randomBytes(SECRET_BYTES).toString('hex')
  try {
    writeFileSync(file, created, { flag: 'wx', mode: OWNER_ONLY })
    return created
  } catch (error) {
    if (!isTaken(error)) throw error
    const winner = readSecret(file)
    if (winner === undefined) throw error
    return winner
  }
}
