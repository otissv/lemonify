import { createFileRoute } from '@tanstack/react-router'

import { guardUpload } from '@/server/http/upload-guard'
import { onlyMethods } from '@/server/http/api-methods'
import { protectedRoute } from '@/server/http/route-guard'
import { toSourceSummary } from '@/server/services/source-service'

const CREATED = 201

/** `POST /api/sources`: the body is the image bytes, with `Content-Type` and `X-File-Name` headers. */
const uploadSource = protectedRoute<Record<string, never>>(
  'upload',
  async ({ request, actor, runtime }) => {
    const { app } = runtime
    const upload = guardUpload(request, app.config.maxUploadBytes)
    const source = await app.sources.upload(actor, upload.body, upload.fileName)
    return Response.json(
      { data: [toSourceSummary(source)], error: '' },
      { status: CREATED },
    )
  },
)

export const Route = createFileRoute('/api/sources')({
  server: { handlers: onlyMethods({ POST: uploadSource }) },
})
