import { RATE_LIMITS } from './rate-limiter.ts'
import type { FixedWindowRateLimiter, RateLimitKind } from './rate-limiter.ts'

/** The sign-in routes that make the server send an email. */
const EMAIL_ROUTES: ReadonlySet<string> = new Set([
  '/api/auth/sign-up/email',
  '/api/auth/request-password-reset',
  '/api/auth/send-verification-email',
])

/** Bodies of these routes are a few fields; anything bigger is not worth reading for an address. */
const MAX_READABLE_BODY_BYTES = 4096

function tooMany(seconds: number): Response {
  return new Response(
    JSON.stringify({
      code: 'RATE_LIMITED',
      message: `Too many requests. Try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`,
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(seconds),
      },
    },
  )
}

async function targetOf(request: Request): Promise<string | undefined> {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_READABLE_BODY_BYTES) return undefined
  try {
    const body: unknown = await request.clone().json()
    if (typeof body !== 'object' || body === null || !('email' in body)) {
      return undefined
    }
    const { email } = body
    return typeof email === 'string' ? email.trim().toLowerCase() : undefined
  } catch {
    return undefined
  }
}

/**
 * The limits in front of Better Auth's routes, which it does not apply
 * everywhere (its own limiter is off outside production and cannot see the
 * address behind a proxy). Returns the 429 to send, or null to carry on. The
 * routes that send email are held to a far lower rate, both per address and
 * per recipient, because each one costs money and can fill a stranger's inbox.
 */
export async function guardAuthRequest(
  limiter: FixedWindowRateLimiter,
  request: Request,
  address: string,
): Promise<Response | null> {
  const checks: Array<[RateLimitKind, string]> = [
    ['auth', `address:${address}`],
  ]
  if (EMAIL_ROUTES.has(new URL(request.url).pathname)) {
    checks.push(['authEmail', `address:${address}`])
    const target = await targetOf(request)
    if (target !== undefined) checks.push(['authTarget', `email:${target}`])
  }
  for (const [kind, key] of checks) {
    const decision = limiter.take(`${kind}:${key}`, RATE_LIMITS[kind])
    if (!decision.allowed) return tooMany(decision.retryAfterSeconds)
  }
  return null
}
