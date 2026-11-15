import '@tanstack/react-start/server-only'

import { getRequestIP } from '@tanstack/react-start/server'

import type { Actor } from '../domain/actor.ts'
import { errorResponse } from './client-error.ts'
import { guardRequest } from './guard.ts'
import type { RateLimitKind } from './rate-limiter.ts'
import { getRuntime } from './runtime.ts'
import type { WebRuntime } from './runtime.ts'

const UNKNOWN_ADDRESS = 'unknown'

export type GuardedRouteContext<TParams> = {
  request: Request
  params: TParams
  actor: Actor
  runtime: WebRuntime
}

/**
 * Wraps an API route handler with the same checks as a protected server
 * function, and answers failures as `{ data: [], error }`. API routes use
 * this instead of reading the request themselves.
 */
export function protectedRoute<TParams>(
  limit: RateLimitKind,
  handler: (context: GuardedRouteContext<TParams>) => Promise<Response>,
): (context: { request: Request; params: TParams }) => Promise<Response> {
  return async ({ request, params }) => {
    const runtime = await getRuntime()
    const route = new URL(request.url).pathname
    try {
      const actor = await guardRequest(
        runtime,
        {
          headers: request.headers,
          address: getRequestIP() ?? UNKNOWN_ADDRESS,
        },
        { requireActor: true, limit },
      )
      if (actor === null) throw new Error('A signed-in User is required.')
      const started = Date.now()
      const response = await handler({ request, params, actor, runtime })
      runtime.logger.info('route', {
        method: request.method,
        path: route,
        status: response.status,
        userId: actor.userId,
        ms: Date.now() - started,
      })
      return response
    } catch (error) {
      return errorResponse(error, runtime.logger, {
        method: request.method,
        path: route,
      })
    }
  }
}
