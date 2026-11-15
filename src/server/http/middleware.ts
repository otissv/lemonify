import { createMiddleware } from '@tanstack/react-start'
import { getRequest, getRequestIP } from '@tanstack/react-start/server'
import { ZodError } from 'zod'

import { ValidationError } from '../errors.ts'
import { describeFailure } from './client-error.ts'
import { guardRequest } from './guard.ts'
import type { RateLimitKind } from './rate-limiter.ts'
import { getRuntime } from './runtime.ts'

const UNKNOWN_ADDRESS = 'unknown'

function firstIssue(error: ZodError): string {
  return error.issues[0]?.message ?? 'The request is not valid.'
}

/**
 * Turns every failure into a plain-words error before it leaves the server:
 * deliberate errors keep their message, anything else is logged and replaced
 * by a general one. Redirects and other non-error throws pass through.
 */
export const errorsMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    try {
      return await next()
    } catch (error) {
      if (!(error instanceof Error)) throw error
      const runtime = await getRuntime()
      const failure =
        error instanceof ZodError
          ? new ValidationError(firstIssue(error))
          : error
      throw new Error(describeFailure(failure, runtime.logger).message)
    }
  },
)

function guardMiddleware(requireActor: boolean, limit: RateLimitKind) {
  return createMiddleware({ type: 'function' }).server(async ({ next }) => {
    const runtime = await getRuntime()
    const request = getRequest()
    const actor = await guardRequest(
      runtime,
      {
        headers: request.headers,
        address: getRequestIP() ?? UNKNOWN_ADDRESS,
      },
      { requireActor, limit },
    )
    const started = Date.now()
    const result = await next({ context: { actor } })
    runtime.logger.info('server function', {
      method: request.method,
      path: new URL(request.url).pathname,
      userId: actor?.userId ?? null,
      ms: Date.now() - started,
    })
    return result
  })
}

/** A signed-in User is required, and the User and address are rate limited. */
export function sessionMiddleware(limit: RateLimitKind = 'default') {
  return guardMiddleware(true, limit)
}

/** For the few functions that work before sign-in; the address is rate limited. */
export function publicMiddleware(limit: RateLimitKind = 'default') {
  return guardMiddleware(false, limit)
}
