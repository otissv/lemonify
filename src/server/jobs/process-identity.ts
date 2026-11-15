/** Names one running process, so a Job can say who holds it and others can tell whether that process is still there. */
export type ProcessIdentity = {
  pid: number
  /** When the process started, as an ISO time. */
  startedAt: string
}

export type ProcessProbe = (pid: number) => boolean

const SEPARATOR = '@'
const MILLISECONDS_PER_SECOND = 1000

export function currentIdentity(): ProcessIdentity {
  const started = Date.now() - process.uptime() * MILLISECONDS_PER_SECOND
  return { pid: process.pid, startedAt: new Date(started).toISOString() }
}

/** The text stored in `jobs.claimed_by`. */
export function formatClaim(identity: ProcessIdentity): string {
  return `${identity.pid}${SEPARATOR}${identity.startedAt}`
}

function pidOf(claim: string): number | undefined {
  const pid = Number.parseInt(claim.split(SEPARATOR)[0] ?? '', 10)
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

/** Whether a process with this pid exists. A process we may not signal still exists. */
export const probeProcess: ProcessProbe = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

/**
 * Whether the process that made a claim is still running. Our own claims are
 * compared by start time, so a restarted process reusing a pid does not look
 * alive; for another process the pid is all that can be checked.
 */
export function isClaimAlive(
  claim: string,
  self: ProcessIdentity,
  probe: ProcessProbe = probeProcess,
): boolean {
  const pid = pidOf(claim)
  if (pid === undefined) return false
  if (pid === self.pid) return claim === formatClaim(self)
  return probe(pid)
}
