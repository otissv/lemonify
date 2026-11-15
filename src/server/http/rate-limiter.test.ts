import { describe, expect, it } from 'vitest'

import { FixedWindowRateLimiter } from './rate-limiter'

describe('FixedWindowRateLimiter', () => {
  it('allows up to the limit and then says how long to wait', () => {
    let now = 1_000
    const limiter = new FixedWindowRateLimiter(() => now)
    const rule = { limit: 2, windowMs: 10_000 }
    expect(limiter.take('a', rule)).toEqual({ allowed: true })
    expect(limiter.take('a', rule)).toEqual({ allowed: true })
    now += 4_000
    expect(limiter.take('a', rule)).toEqual({
      allowed: false,
      retryAfterSeconds: 6,
    })
  })

  it('starts a new window after the old one ends', () => {
    let now = 0
    const limiter = new FixedWindowRateLimiter(() => now)
    const rule = { limit: 1, windowMs: 1_000 }
    expect(limiter.take('a', rule).allowed).toBe(true)
    expect(limiter.take('a', rule).allowed).toBe(false)
    now = 1_000
    expect(limiter.take('a', rule).allowed).toBe(true)
  })

  it('counts each key on its own', () => {
    const limiter = new FixedWindowRateLimiter(() => 0)
    const rule = { limit: 1, windowMs: 1_000 }
    expect(limiter.take('a', rule).allowed).toBe(true)
    expect(limiter.take('b', rule).allowed).toBe(true)
    expect(limiter.take('a', rule).allowed).toBe(false)
  })
})
