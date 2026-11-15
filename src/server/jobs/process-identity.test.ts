import { describe, expect, it } from 'vitest'

import {
  currentIdentity,
  formatClaim,
  isClaimAlive,
  probeProcess,
} from './process-identity.ts'

const SELF = { pid: 100, startedAt: '2026-01-01T00:00:00.000Z' }

describe('process identity', () => {
  it('names this process by pid and start time', () => {
    const identity = currentIdentity()
    expect(identity.pid).toBe(process.pid)
    expect(new Date(identity.startedAt).getTime()).toBeLessThanOrEqual(
      Date.now(),
    )
  })

  it('knows its own live claim', () => {
    expect(isClaimAlive(formatClaim(SELF), SELF)).toBe(true)
  })

  it('treats a claim from an earlier run of the same pid as dead', () => {
    const earlier = { pid: 100, startedAt: '2025-12-31T00:00:00.000Z' }
    expect(isClaimAlive(formatClaim(earlier), SELF)).toBe(false)
  })

  it('asks the system about another process', () => {
    const other = formatClaim({ pid: 200, startedAt: SELF.startedAt })
    expect(isClaimAlive(other, SELF, (pid) => pid === 200)).toBe(true)
    expect(isClaimAlive(other, SELF, () => false)).toBe(false)
  })

  it('treats a claim it cannot read as dead', () => {
    expect(isClaimAlive('nonsense', SELF)).toBe(false)
  })

  it('probes the real system', () => {
    expect(probeProcess(process.pid)).toBe(true)
  })
})
