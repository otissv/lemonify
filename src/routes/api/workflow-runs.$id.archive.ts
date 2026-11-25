import { createFileRoute } from '@tanstack/react-router'

import { protectedRoute } from '@/server/http/route-guard'
import { streamResponse } from '@/server/http/stream-response'

/** `GET /api/workflow-runs/<id>/archive`: every finished image of a run, in one zip file to download. */
const serveRunArchive = protectedRoute<{ id: string }>(
  'default',
  async ({ params, actor, runtime }) => {
    const opened = await runtime.app.workflows.openRunArchive(actor, params.id)
    return streamResponse({
      stream: opened.stream,
      mediaType: opened.mediaType,
      bytes: opened.bytes,
      downloadAs: opened.fileName,
      immutable: false,
    })
  },
)

export const Route = createFileRoute('/api/workflow-runs/$id/archive')({
  server: { handlers: { GET: serveRunArchive } },
})
