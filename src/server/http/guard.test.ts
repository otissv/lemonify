import { describe, expect, it } from 'vitest'

import { LimitError, UnauthorizedError } from '../errors'
import { guardRequest } from './guard'
import type { HttpRuntime } from './guard'
import { MemoryLogger } from './logger'
import { FixedWindowRateLimiter, RATE_LIMITS } from './rate-limiter'

function runtime(actor: { userId: string; name: string } | null): HttpRuntime {
  return {
    auth: { getActor: async () => actor },
    logger: new MemoryLogger(),
    rateLimiter: new FixedWindowRateLimiter(() => 0),
  }
}

const request = { headers: new Headers(), address: '10.0.0.1' }

describe('guardRequest', () => {
  it('returns the signed-in User', async () => {
    const actor = { userId: 'u1', name: 'Ann' }
    expect(
      await guardRequest(runtime(actor), request, {
        requireActor: true,
        limit: 'default',
      }),
    ).toEqual(actor)
  })

  it('refuses a caller who is not signed in with 401 semantics', async () => {
    await expect(
      guardRequest(runtime(null), request, {
        requireActor: true,
        limit: 'default',
      }),
    ).rejects.toThrow(UnauthorizedError)
  })

  it('lets a public endpoint through without a User', async () => {
    expect(
      await guardRequest(runtime(null), request, {
        requireActor: false,
        limit: 'default',
      }),
    ).toBeNull()
  })

  it('limits an address before it looks up the session', async () => {
    let lookups = 0
    const guarded: HttpRuntime = {
      auth: {
        getActor: async () => {
          lookups += 1
          return null
        },
      },
      logger: new MemoryLogger(),
      rateLimiter: new FixedWindowRateLimiter(() => 0),
    }
    const options = { requireActor: true, limit: 'upload' } as const
    for (let i = 0; i < RATE_LIMITS.upload.limit; i += 1) {
      await expect(guardRequest(guarded, request, options)).rejects.toThrow(
        UnauthorizedError,
      )
    }
    const before = lookups
    await expect(guardRequest(guarded, request, options)).rejects.toThrow(
      LimitError,
    )
    expect(lookups).toBe(before)
  })

  it('limits a User across addresses, with a stricter limit for uploads', async () => {
    const actor = { userId: 'u1', name: 'Ann' }
    const guarded = runtime(actor)
    const options = { requireActor: true, limit: 'upload' } as const
    for (let i = 0; i < RATE_LIMITS.upload.limit; i += 1) {
      await guardRequest(
        guarded,
        { ...request, address: `10.0.0.${i}` },
        options,
      )
    }
    await expect(
      guardRequest(guarded, { ...request, address: '10.9.9.9' }, options),
    ).rejects.toThrow(/Too many requests/)
    expect(RATE_LIMITS.upload.limit).toBeLessThan(RATE_LIMITS.default.limit)
  })
})
