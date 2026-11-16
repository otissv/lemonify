import { documentFileUrl } from '@/features/documents/document-file'
import { settleDocument } from '@/features/documents/document-sync'

/**
 * Saves a document as a file. The edits still on their way are sent first, so
 * the file holds what the editor shows. The browser's own download manager
 * takes it from there, which shows progress and never holds the file in memory.
 */
export async function downloadDocument(documentId: string): Promise<void> {
  await settleDocument(documentId)
  const link = document.createElement('a')
  link.href = documentFileUrl(documentId)
  link.download = ''
  link.hidden = true
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
  }
}
