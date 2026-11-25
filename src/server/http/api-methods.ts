import type { AppResponse } from './client-error.ts'

/** The methods an API route can be asked for; the framework answers HEAD and OPTIONS itself. */
export const ROUTE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

export type RouteMethod = (typeof ROUTE_METHODS)[number]

type RouteHandler<TParams> = (context: {
  request: Request
  params: TParams
}) => Promise<Response>

const METHOD_NOT_ALLOWED = 405
const NOT_FOUND = 404
const NOTHING_HERE = 'There is nothing at this address.'

function failure(
  status: number,
  error: string,
  headers: HeadersInit = {},
): Response {
  const body: AppResponse<never> = { data: [], error }
  return Response.json(body, { status, headers })
}

/**
 * A route's handlers for every method: the ones it has, and a 405 naming the
 * methods it takes for the rest. Without this, a method a route does not have
 * falls through to the website and is answered with a page and a 200.
 */
export function onlyMethods<TParams>(
  handlers: Partial<Record<RouteMethod, RouteHandler<TParams>>>,
): Record<RouteMethod, RouteHandler<TParams>> {
  const allowed = ROUTE_METHODS.filter(
    (method) => handlers[method] !== undefined,
  )
  const refuse: RouteHandler<TParams> = async () =>
    failure(METHOD_NOT_ALLOWED, `Use ${allowed.join(' or ')} here.`, {
      Allow: allowed.join(', '),
    })
  return {
    GET: handlers.GET ?? refuse,
    POST: handlers.POST ?? refuse,
    PUT: handlers.PUT ?? refuse,
    PATCH: handlers.PATCH ?? refuse,
    DELETE: handlers.DELETE ?? refuse,
  }
}

/** Handlers that answer every method 404, for API addresses no route has. */
export function notFoundRoute<TParams>(): Record<
  RouteMethod,
  RouteHandler<TParams>
> {
  const missing: RouteHandler<TParams> = async () =>
    failure(NOT_FOUND, NOTHING_HERE)
  return {
    GET: missing,
    POST: missing,
    PUT: missing,
    PATCH: missing,
    DELETE: missing,
  }
}
