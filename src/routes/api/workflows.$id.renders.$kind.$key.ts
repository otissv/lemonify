import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { NotFoundError } from '@/server/errors'
import { onlyMethods } from '@/server/http/api-methods'
import { protectedRoute } from '@/server/http/route-guard'
import { streamResponse } from '@/server/http/stream-response'
import { RenderKind } from '@/server/tools/render-store'

const MISSING = 'That picture is not available.'
const KindSchema = z.enum(RenderKind)

/** `GET /api/workflows/<id>/renders/<kind>/<key>`: a workflow diagram thumbnail. */
const serveRender = protectedRoute<{ id: string; kind: string; key: string }>(
  'default',
  async ({ params, actor, runtime }) => {
    const kind = KindSchema.safeParse(params.kind)
    if (!kind.success) throw new NotFoundError(MISSING)
    const opened = await runtime.app.renders.fetchWorkflow(
      actor,
      params.id,
      kind.data,
      params.key,
    )
    return streamResponse({ ...opened, immutable: true })
  },
)

export const Route = createFileRoute('/api/workflows/$id/renders/$kind/$key')({
  server: { handlers: onlyMethods({ GET: serveRender }) },
})
