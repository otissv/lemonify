import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { settlePipeline } from '@/features/pipeline/pipeline-sync'
import { downloadDocument } from '@/features/documents/download-document'

vi.mock('@/features/pipeline/pipeline-sync', () => ({
  settlePipeline: vi.fn(),
}))

const DISPOSITION = `attachment; filename="kant.lemon"; filename*=UTF-8''kant.lemon`

function zipResponse(parts: string[], headers: Record<string, string> = {}) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts)
        controller.enqueue(new TextEncoder().encode(part))
      controller.close()
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'application/zip',
      'content-length': String(total),
      'content-disposition': DISPOSITION,
      ...headers,
    },
  })
}

let saved: Array<{ href: string; name: string }>

beforeEach(() => {
  saved = []
  vi.mocked(settlePipeline).mockResolvedValue()
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:saved'),
    revokeObjectURL: vi.fn(),
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ href: this.href, name: this.download })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('downloadDocument', () => {
  it('waits for the document’s edits to reach the server before it asks for the file', async () => {
    let finish: () => void = () => {}
    vi.mocked(settlePipeline).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(zipResponse(['zip'])))

    const started = downloadDocument('doc 1', () => {})
    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
    finish()
    await started

    expect(fetch).toHaveBeenCalledWith('/api/documents/doc%201/bundle')
  })

  it('saves what it received under the name the server gave, and says the name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(zipResponse(['ab', 'cd'])))

    const name = await downloadDocument('d1', () => {})

    expect(name).toBe('kant.lemon')
    expect(saved).toEqual([{ href: 'blob:saved', name: 'kant.lemon' }])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:saved')
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(await (blob as Blob).text()).toBe('abcd')
  })

  it('reports how much has arrived of the whole', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(zipResponse(['ab', 'cdef'])),
    )
    const seen: Array<{ loaded: number; total: number | undefined }> = []

    await downloadDocument('d1', (progress) => seen.push(progress))

    expect(seen.at(0)).toEqual({ loaded: 0, total: 6 })
    expect(seen.at(-1)).toEqual({ loaded: 6, total: 6 })
  })

  it('reports progress without a total when the server did not say the size', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(zipResponse(['ab'], { 'content-length': '' })),
    )
    const seen: Array<{ loaded: number; total: number | undefined }> = []

    await downloadDocument('d1', (progress) => seen.push(progress))

    expect(seen.at(-1)).toEqual({ loaded: 2, total: undefined })
  })

  it('says why the server refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ data: [], error: 'That image does not exist.' }),
            { status: 404 },
          ),
        ),
    )

    await expect(downloadDocument('d1', () => {})).rejects.toThrow(
      'That image does not exist.',
    )
    expect(saved).toEqual([])
  })

  it('has a plain message when the answer is not what the server normally sends', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<html>Bad gateway</html>', { status: 502 }),
        ),
    )

    await expect(downloadDocument('d1', () => {})).rejects.toThrow(
      'The document could not be saved.',
    )
  })

  it('falls back to a name of its own when the server sent none', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(zipResponse(['x'], { 'content-disposition': '' })),
    )

    expect(await downloadDocument('d1', () => {})).toBe('document.lemon')
  })

  it('leaves no link behind in the page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(zipResponse(['x'])))

    await downloadDocument('d1', () => {})

    expect(document.querySelector('a[download]')).toBeNull()
  })
})
