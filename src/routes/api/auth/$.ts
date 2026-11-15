import { createFileRoute } from '@tanstack/react-router'

import { getRuntime } from '@/server/http/runtime'

async function handleAuth({
  request,
}: {
  request: Request
}): Promise<Response> {
  const runtime = await getRuntime()
  return runtime.app.auth.handle(request)
}

export const Route = createFileRoute('/api/auth/$')({
  server: { handlers: { GET: handleAuth, POST: handleAuth } },
})
