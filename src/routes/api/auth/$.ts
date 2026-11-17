import { createFileRoute } from '@tanstack/react-router'
import { getRequestIP } from '@tanstack/react-start/server'

import { guardAuthRequest } from '@/server/http/auth-guard'
import { getRuntime } from '@/server/http/runtime'

const UNKNOWN_ADDRESS = 'unknown'

async function handleAuth({
  request,
}: {
  request: Request
}): Promise<Response> {
  const runtime = await getRuntime()
  const refused = await guardAuthRequest(
    runtime.rateLimiter,
    request,
    getRequestIP() ?? UNKNOWN_ADDRESS,
  )
  if (refused !== null) return refused
  return runtime.app.auth.handle(request)
}

export const Route = createFileRoute('/api/auth/$')({
  server: { handlers: { GET: handleAuth, POST: handleAuth } },
})
