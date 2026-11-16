/** A document saved as one file: its extension and media type, shared by the website, the server and the CLI. */
export const DOCUMENT_FILE_EXTENSION = '.lemon'
export const DOCUMENT_FILE_MEDIA_TYPE = 'application/zip'

/** The address that downloads a document as a file. */
export function documentFileUrl(documentId: string): string {
  return `/api/documents/${encodeURIComponent(documentId)}/bundle`
}
