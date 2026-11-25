import { createFileRoute } from '@tanstack/react-router'

import { notFoundRoute } from '@/server/http/api-methods'

/** Any address under /api that no route has: a 404 in the API's own shape, not the website's page. */
export const Route = createFileRoute('/api/$')({
  server: { handlers: notFoundRoute<{ _splat?: string }>() },
})
