import { createFileRoute } from '@tanstack/react-router'

import { onlyMethods } from '@/server/http/api-methods'
import { protectedRoute } from '@/server/http/route-guard'
import { streamResponse } from '@/server/http/stream-response'

/** `GET /api/sources/<id>`: the uploaded image, as it was uploaded. */
const serveSource = protectedRoute<{ id: string }>(
  'default',
  async ({ params, actor, runtime }) => {
    const opened = await runtime.app.sources.open(actor, params.id)
    return streamResponse({ ...opened, immutable: true })
  },
)

export const Route = createFileRoute('/api/sources/$id')({
  server: { handlers: onlyMethods({ GET: serveSource }) },
})
