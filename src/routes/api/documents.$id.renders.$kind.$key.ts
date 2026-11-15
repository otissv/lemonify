import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { NotFoundError } from '@/server/errors'
import { protectedRoute } from '@/server/http/route-guard'
import { streamResponse } from '@/server/http/stream-response'
import { RenderKind } from '@/server/tools/render-store'

const MISSING = 'That picture is not available.'
const KindSchema = z.enum(RenderKind)

/** `GET /api/documents/<id>/renders/<kind>/<key>`: a preview or thumbnail that a Job made. */
const serveRender = protectedRoute<{ id: string; kind: string; key: string }>(
  'default',
  async ({ params, actor, runtime }) => {
    const kind = KindSchema.safeParse(params.kind)
    if (!kind.success) throw new NotFoundError(MISSING)
    const opened = await runtime.app.renders.fetch(
      actor,
      params.id,
      kind.data,
      params.key,
    )
    return streamResponse({ ...opened, immutable: true })
  },
)

export const Route = createFileRoute('/api/documents/$id/renders/$kind/$key')({
  server: { handlers: { GET: serveRender } },
})
