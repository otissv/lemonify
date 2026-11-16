import {
  DOCUMENT_FILE_EXTENSION,
  documentFileUrl,
} from '@/features/documents/document-file'
import { settleDocument } from '@/features/documents/document-sync'
import { readErrorMessage } from '@/lib/read-error-message'

const SAVE_FAILED = 'The document could not be saved.'
const FALLBACK_NAME = `document${DOCUMENT_FILE_EXTENSION}`

export interface DownloadProgress {
  loaded: number
  /** The size of the whole file, when the server said it. */
  total: number | undefined
}

function fileNameOf(response: Response): string {
  const header = response.headers.get('content-disposition') ?? ''
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  if (encoded !== undefined) {
    try {
      return decodeURIComponent(encoded)
    } catch {
      // The plain name below is used instead.
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? FALLBACK_NAME
}

function totalOf(response: Response): number | undefined {
  const length = Number(response.headers.get('content-length'))
  return Number.isFinite(length) && length > 0 ? length : undefined
}

async function receive(
  response: Response,
  onProgress: (progress: DownloadProgress) => void,
): Promise<Blob> {
  const total = totalOf(response)
  const chunks: BlobPart[] = []
  let loaded = 0
  onProgress({ loaded, total })
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error(SAVE_FAILED)
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    onProgress({ loaded, total })
  }
  return new Blob(chunks, { type: response.headers.get('content-type') ?? '' })
}

function save(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.hidden = true
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    URL.revokeObjectURL(url)
  }
}

/**
 * Saves a document as a file and answers with the name it was saved under. The
 * edits still on their way are sent first, so the file holds what the editor
 * shows. The file is received here, not handed to the browser's download
 * manager, so progress and any refusal can be shown on the page.
 */
export async function downloadDocument(
  documentId: string,
  onProgress: (progress: DownloadProgress) => void,
): Promise<string> {
  await settleDocument(documentId)
  const response = await fetch(documentFileUrl(documentId))
  if (!response.ok)
    throw new Error(await readErrorMessage(response, SAVE_FAILED))
  const fileName = fileNameOf(response)
  save(await receive(response, onProgress), fileName)
  return fileName
}
