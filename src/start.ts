import { errorsMiddleware } from '@/server/http/middleware'
import {
  createCsrfMiddleware,
  createServerOnlyFn,
  createStart,
} from '@tanstack/react-start'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Applies to every request the app handles, pages, API routes and server
 * functions alike, so no endpoint can forget it. A request that changes data
 * must come from this site: its Sec-Fetch-Site says same-origin, or its
 * Origin is one of the trusted origins. Requests with none of those headers
 * are not made by a browser, so they cannot be a cross-site forgery, and the
 * session check still applies to them.
 */
const isTrustedOrigin = createServerOnlyFn(
  async (origin: string): Promise<boolean> => {
    const { getRuntime } = await import('@/server/http/runtime')
    const { app } = await getRuntime()
    return app.config.trustedOrigins.includes(origin)
  },
)

const csrf = createCsrfMiddleware({
  filter: ({ request }) => !SAFE_METHODS.has(request.method),
  origin: (origin) => isTrustedOrigin(origin),
  allowRequestsWithoutOriginCheck: true,
})

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf],
  functionMiddleware: [errorsMiddleware],
}))
