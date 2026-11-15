import { Readable } from 'node:stream'

export type StreamedFile = {
  stream: Readable
  mediaType: string
  /** Size in bytes, when known, so the browser can show progress. */
  bytes?: number
  /** When set the browser saves the file under this name instead of showing it. */
  downloadAs?: string
  /** Whether the same address will always give the same bytes. */
  immutable: boolean
}

const A_YEAR_SECONDS = 31_536_000

/** `Content-Disposition` for a download: ASCII fallback plus the real name, both safe against header injection. */
export function attachment(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\%;]/g, '_')
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

/**
 * A response that streams a stored image to its owner. It is private to the
 * browser (no shared caches), never sniffed into another type, and sandboxed
 * so an image opened by itself can run nothing.
 */
export function streamResponse(file: StreamedFile): Response {
  const headers = new Headers({
    'Content-Type': file.mediaType,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': file.immutable
      ? `private, max-age=${A_YEAR_SECONDS}, immutable`
      : 'private, no-cache',
  })
  if (file.bytes !== undefined)
    headers.set('Content-Length', String(file.bytes))
  if (file.downloadAs !== undefined) {
    headers.set('Content-Disposition', attachment(file.downloadAs))
  }
  const body = Readable.toWeb(file.stream)
  return new Response(body as unknown as ReadableStream, { headers })
}
