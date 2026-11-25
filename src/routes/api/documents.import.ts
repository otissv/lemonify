import { createFileRoute } from '@tanstack/react-router'

import { guardBundleUpload } from '@/server/http/bundle-upload-guard'
import { onlyMethods } from '@/server/http/api-methods'
import { protectedRoute } from '@/server/http/route-guard'

const CREATED = 201

/** `POST /api/documents/import`: the body is a document file; the result is the new document. */
const importDocument = protectedRoute<Record<string, never>>(
  'upload',
  async ({ request, actor, runtime }) => {
    const { app } = runtime
    const body = guardBundleUpload(request, app.config.maxBundleBytes)
    const imported = await app.bundles.importStream(actor, body)
    return Response.json(
      { data: [imported.document], error: '' },
      { status: CREATED },
    )
  },
)

export const Route = createFileRoute('/api/documents/import')({
  server: { handlers: onlyMethods({ POST: importDocument }) },
})
