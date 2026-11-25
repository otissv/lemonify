import { createFileRoute } from '@tanstack/react-router'

import { onlyMethods } from '@/server/http/api-methods'
import { protectedRoute } from '@/server/http/route-guard'
import { streamResponse } from '@/server/http/stream-response'

/** `GET /api/documents/<id>/bundle`: the document itself (pipeline, images and AI results) as a file to download. */
const serveBundle = protectedRoute<{ id: string }>(
  'upload',
  async ({ params, actor, runtime }) => {
    const opened = await runtime.app.bundles.openExport(actor, params.id)
    return streamResponse({
      stream: opened.stream,
      mediaType: opened.mediaType,
      bytes: opened.bytes,
      downloadAs: opened.fileName,
      immutable: false,
    })
  },
)

export const Route = createFileRoute('/api/documents/$id/bundle')({
  server: { handlers: onlyMethods({ GET: serveBundle }) },
})
