import { z } from 'zod'

import { DOCUMENT_FILE_MEDIA_TYPE } from '@/features/documents/document-file'

const IMPORT_FAILED = 'The document could not be opened.'

const ImportResponseSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
  error: z.string(),
})

/** Sends a document file from this computer; the server makes a new document from it and answers with its id. */
export async function uploadDocumentFile(file: File): Promise<string> {
  const response = await fetch('/api/documents/import', {
    method: 'POST',
    headers: { 'Content-Type': DOCUMENT_FILE_MEDIA_TYPE },
    body: file,
  })
  const parsed = ImportResponseSchema.safeParse(
    await response.json().catch(() => undefined),
  )
  if (!parsed.success) throw new Error(IMPORT_FAILED)
  const [document] = parsed.data.data
  if (!response.ok || document === undefined) {
    throw new Error(parsed.data.error || IMPORT_FAILED)
  }
  return document.id
}
