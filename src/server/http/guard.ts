import type { Actor } from '../domain/actor.ts'
import { LimitError, UnauthorizedError } from '../errors.ts'
import type { AuthGateway } from '../auth/auth-gateway.ts'
import type { Logger } from './logger.ts'
import { RATE_LIMITS } from './rate-limiter.ts'
import type { FixedWindowRateLimiter, RateLimitKind } from './rate-limiter.ts'

export type HttpRuntime = {
  auth: Pick<AuthGateway, 'getActor'>
  logger: Logger
  rateLimiter: FixedWindowRateLimiter
}

export type GuardOptions = {
  /** Whether a signed-in User is needed; if so the User is returned. */
  requireActor: boolean
  limit: RateLimitKind
}

function limitMessage(seconds: number): string {
  return `Too many requests. Try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`
}

function take(runtime: HttpRuntime, key: string, limit: RateLimitKind): void {
  const decision = runtime.rateLimiter.take(
    `${limit}:${key}`,
    RATE_LIMITS[limit],
  )
  if (!decision.allowed)
    throw new LimitError(limitMessage(decision.retryAfterSeconds))
}

/**
 * The checks every endpoint shares, in the order the plan gives: the address
 * is rate limited first (so sign-in guessing is slowed), then the caller is
 * identified, then the User is rate limited. The endpoint only runs if all
 * pass. Server functions and API routes both call this one function.
 */
export async function guardRequest(
  runtime: HttpRuntime,
  request: { headers: Headers; address: string },
  options: GuardOptions,
): Promise<Actor | null> {
  take(runtime, `address:${request.address}`, options.limit)
  if (!options.requireActor) return null
  const actor = await runtime.auth.getActor(request.headers)
  if (actor === null) throw new UnauthorizedError()
  take(runtime, `user:${actor.userId}`, options.limit)
  return actor
}
