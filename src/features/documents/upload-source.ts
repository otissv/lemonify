import { z } from 'zod'

import type { SourceSummary } from '@/features/documents/document'

const UPLOAD_FAILED = 'The image could not be uploaded.'

const SourceSummarySchema = z.object({
  id: z.string(),
  fileName: z.string(),
  mediaType: z.string(),
  bytes: z.number(),
  width: z.number(),
  height: z.number(),
})

const UploadResponseSchema = z.object({
  data: z.array(SourceSummarySchema),
  error: z.string(),
})

/** Uploads an image from this computer as a Source: the bytes go as the body, the type and name as headers. */
export async function uploadSource(file: File): Promise<SourceSummary> {
  const response = await fetch('/api/sources', {
    method: 'POST',
    headers: {
      'Content-Type': file.type,
      'X-File-Name': encodeURIComponent(file.name),
    },
    body: file,
  })
  const parsed = UploadResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new Error(UPLOAD_FAILED)
  const [source] = parsed.data.data
  if (!response.ok || source === undefined) {
    throw new Error(parsed.data.error || UPLOAD_FAILED)
  }
  return source
}
