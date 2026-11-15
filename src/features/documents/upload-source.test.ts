import { afterEach, describe, expect, it, vi } from 'vitest'

import { uploadSource } from '@/features/documents/upload-source'

const SOURCE = {
  id: 's1',
  fileName: 'my cat.png',
  mediaType: 'image/png',
  bytes: 4,
  width: 2,
  height: 2,
}

describe('uploadSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the bytes with the type and the encoded name, and returns the source', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ data: [SOURCE], error: '' }, { status: 201 }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['abcd'], 'my cat.png', { type: 'image/png' })
    expect(await uploadSource(file)).toEqual(SOURCE)
    expect(fetchMock).toHaveBeenCalledWith('/api/sources', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        'X-File-Name': 'my%20cat.png',
      },
      body: file,
    })
  })

  it('shows the reason the server gave when it refuses the image', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { data: [], error: 'Use one of: image/png.' },
            { status: 422 },
          ),
        ),
    )
    await expect(
      uploadSource(new File(['x'], 'a.txt', { type: 'text/plain' })),
    ).rejects.toThrow('Use one of: image/png.')
  })
})
