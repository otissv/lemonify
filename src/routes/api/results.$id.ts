import { createFileRoute } from '@tanstack/react-router'

import { protectedRoute } from '@/server/http/route-guard'
import { streamResponse } from '@/server/http/stream-response'

/** `GET /api/results/<id>`: a finished image (an export, an AI step's output, a run's output) as a download. */
const serveResult = protectedRoute<{ id: string }>(
  'default',
  async ({ params, actor, runtime }) => {
    const opened = await runtime.app.results.open(actor, params.id)
    return streamResponse({
      stream: opened.stream,
      mediaType: opened.mediaType,
      bytes: opened.bytes,
      downloadAs: opened.fileName,
      immutable: false,
    })
  },
)

export const Route = createFileRoute('/api/results/$id')({
  server: { handlers: { GET: serveResult } },
})
