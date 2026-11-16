import { afterEach, describe, expect, it, vi } from 'vitest'

import { uploadDocumentFile } from '@/features/documents/upload-document-file'

const FILE = new File(['zip'], 'a.lemon', { type: 'application/zip' })

function reply(body: BodyInit, status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(body, { status })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('uploadDocumentFile', () => {
  it('sends the file as a zip and answers with the new document’s id', async () => {
    reply(JSON.stringify({ data: [{ id: 'd9', name: 'x' }], error: '' }), 201)

    await expect(uploadDocumentFile(FILE)).resolves.toBe('d9')

    expect(fetch).toHaveBeenCalledWith('/api/documents/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: FILE,
    })
  })

  it('says why the server refused the file', async () => {
    reply(
      JSON.stringify({ data: [], error: 'The document file is too large.' }),
      413,
    )

    await expect(uploadDocumentFile(FILE)).rejects.toThrow(
      'The document file is too large.',
    )
  })

  it('has a plain message when the server answers with something else', async () => {
    reply('<html>Bad gateway</html>', 502)

    await expect(uploadDocumentFile(FILE)).rejects.toThrow(
      'The document could not be opened.',
    )
  })

  it('has a plain message when the answer has no document', async () => {
    reply(JSON.stringify({ data: [], error: '' }), 201)

    await expect(uploadDocumentFile(FILE)).rejects.toThrow(
      'The document could not be opened.',
    )
  })
})
