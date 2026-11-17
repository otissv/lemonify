import { describe, expect, it } from 'vitest'

import { guardAuthRequest } from './auth-guard'
import { FixedWindowRateLimiter, RATE_LIMITS } from './rate-limiter'

const ADDRESS = '10.0.0.1'

function call(
  route: string,
  body: object | undefined,
  address = ADDRESS,
): Request & { address: string } {
  const request = new Request(`http://localhost:3000/api/auth/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return Object.assign(request, { address })
}

function guard(
  limiter: FixedWindowRateLimiter,
  request: ReturnType<typeof call>,
) {
  return guardAuthRequest(limiter, request, request.address)
}

describe('guardAuthRequest', () => {
  it('lets ordinary requests through up to the limit for an address, then says to wait', async () => {
    const limiter = new FixedWindowRateLimiter(() => 0)
    for (let n = 0; n < RATE_LIMITS.auth.limit; n += 1) {
      expect(await guard(limiter, call('sign-in/email', {}))).toBeNull()
    }

    const refused = await guard(limiter, call('sign-in/email', {}))

    expect(refused?.status).toBe(429)
    expect(refused?.headers.get('retry-after')).toBe('60')
    expect(await refused?.json()).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many requests. Try again in 60 seconds.',
    })
  })

  it('counts each address on its own', async () => {
    const limiter = new FixedWindowRateLimiter(() => 0)
    for (let n = 0; n < RATE_LIMITS.auth.limit; n += 1) {
      await guard(limiter, call('sign-in/email', {}))
    }

    expect(
      await guard(limiter, call('sign-in/email', {}, '10.0.0.2')),
    ).toBeNull()
  })

  it('limits the routes that send email much harder', async () => {
    const limiter = new FixedWindowRateLimiter(() => 0)
    for (let n = 0; n < RATE_LIMITS.authEmail.limit; n += 1) {
      expect(
        await guard(
          limiter,
          call('request-password-reset', { email: `a${n}@x.com` }),
        ),
      ).toBeNull()
    }

    const refused = await guard(
      limiter,
      call('request-password-reset', { email: 'z@x.com' }),
    )

    expect(refused?.status).toBe(429)
    expect(refused?.headers.get('retry-after')).toBe('900')
  })

  it('limits email about one address however many addresses ask', async () => {
    const limiter = new FixedWindowRateLimiter(() => 0)
    for (let n = 0; n < RATE_LIMITS.authTarget.limit; n += 1) {
      expect(
        await guard(
          limiter,
          call(
            'request-password-reset',
            { email: 'Victim@x.com' },
            `10.0.0.${n}`,
          ),
        ),
      ).toBeNull()
    }

    const refused = await guard(
      limiter,
      call('send-verification-email', { email: 'victim@x.com' }, '10.9.9.9'),
    )

    expect(refused?.status).toBe(429)
    expect(refused?.headers.get('retry-after')).toBe('3600')
  })

  it('does not count a mistyped password against the address’s email allowance', async () => {
    const limiter = new FixedWindowRateLimiter(() => 0)
    for (let n = 0; n < RATE_LIMITS.authEmail.limit + 1; n += 1) {
      expect(
        await guard(limiter, call('sign-in/email', { email: 'a@x.com' })),
      ).toBeNull()
    }
  })

  it('does not stop a request with no readable body; Better Auth refuses it', async () => {
    const limiter = new FixedWindowRateLimiter(() => 0)

    expect(
      await guard(limiter, call('request-password-reset', undefined)),
    ).toBeNull()
  })

  it('leaves the request’s body readable for Better Auth', async () => {
    const limiter = new FixedWindowRateLimiter(() => 0)
    const request = call('request-password-reset', { email: 'a@x.com' })

    await guard(limiter, request)

    expect(await request.json()).toEqual({ email: 'a@x.com' })
  })
})
