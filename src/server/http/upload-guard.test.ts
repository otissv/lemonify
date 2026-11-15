import { describe, expect, it } from 'vitest'

import { LimitError, ValidationError } from '../errors.ts'
import { guardUpload, sniffMediaType } from './upload-guard.ts'

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2,
])
const JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 9,
])
const GIF = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 5,
])
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56,
])
const AVIF = Uint8Array.from([
  0, 0, 0, 28, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0,
])
const TEXT = new TextEncoder().encode('This is not an image at all, sorry.')

function request(
  body: BodyInit | null,
  headers: Record<string, string>,
): Request {
  return new Request('http://localhost/api/sources', {
    method: 'POST',
    body,
    headers,
    // @ts-expect-error Node needs this to send a stream body
    duplex: 'half',
  })
}

async function read(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  for await (const part of body) parts.push(part)
  return Uint8Array.from(parts.flatMap((part) => [...part]))
}

describe('sniffMediaType', () => {
  it('recognises each image type by its first bytes', () => {
    expect(sniffMediaType(PNG)).toBe('image/png')
    expect(sniffMediaType(JPEG)).toBe('image/jpeg')
    expect(sniffMediaType(GIF)).toBe('image/gif')
    expect(sniffMediaType(WEBP)).toBe('image/webp')
    expect(sniffMediaType(AVIF)).toBe('image/avif')
  })

  it('recognises nothing else', () => {
    expect(sniffMediaType(TEXT)).toBeUndefined()
    expect(sniffMediaType(new Uint8Array(0))).toBeUndefined()
  })
})

describe('guardUpload', () => {
  const limit = 1000

  it('passes a body whose bytes match its declared type, unchanged', async () => {
    const upload = guardUpload(
      request(PNG, { 'content-type': 'image/png', 'x-file-name': 'cat.png' }),
      limit,
    )
    expect(upload.fileName).toBe('cat.png')
    expect(await read(upload.body)).toEqual(PNG)
  })

  it('reads a name that was percent-encoded', () => {
    const upload = guardUpload(
      request(PNG, {
        'content-type': 'image/png',
        'x-file-name': 'caf%C3%A9%20noir.png',
      }),
      limit,
    )
    expect(upload.fileName).toBe('café noir.png')
  })

  it('ignores parameters and case in the declared type', async () => {
    const upload = guardUpload(
      request(JPEG, {
        'content-type': 'Image/JPEG; charset=binary',
        'x-file-name': 'a.jpg',
      }),
      limit,
    )
    expect(await read(upload.body)).toEqual(JPEG)
  })

  it('refuses a type the app does not take', () => {
    expect(() =>
      guardUpload(
        request(TEXT, { 'content-type': 'text/html', 'x-file-name': 'a.html' }),
        limit,
      ),
    ).toThrow(ValidationError)
    expect(() =>
      guardUpload(request(PNG, { 'x-file-name': 'a.png' }), limit),
    ).toThrow(ValidationError)
  })

  it('refuses a missing, empty, broken or too long name', () => {
    const headers = { 'content-type': 'image/png' }
    expect(() => guardUpload(request(PNG, headers), limit)).toThrow(
      /X-File-Name/,
    )
    expect(() =>
      guardUpload(request(PNG, { ...headers, 'x-file-name': '  ' }), limit),
    ).toThrow(ValidationError)
    expect(() =>
      guardUpload(
        request(PNG, { ...headers, 'x-file-name': '%E0%A4%A' }),
        limit,
      ),
    ).toThrow(ValidationError)
    expect(() =>
      guardUpload(
        request(PNG, { ...headers, 'x-file-name': 'a'.repeat(300) }),
        limit,
      ),
    ).toThrow(ValidationError)
  })

  it('refuses a declared length over the limit before reading anything', () => {
    expect(() =>
      guardUpload(
        request(PNG, {
          'content-type': 'image/png',
          'x-file-name': 'a.png',
          'content-length': '5000',
        }),
        limit,
      ),
    ).toThrow(LimitError)
  })

  it('refuses a request with no body', () => {
    expect(() =>
      guardUpload(
        request(null, { 'content-type': 'image/png', 'x-file-name': 'a.png' }),
        limit,
      ),
    ).toThrow(/body/)
  })

  it('stops a body that is not the type it says', async () => {
    const upload = guardUpload(
      request(TEXT, { 'content-type': 'image/png', 'x-file-name': 'a.png' }),
      limit,
    )
    await expect(read(upload.body)).rejects.toThrow('not the kind of image')
  })

  it('stops an image of one type sent as another', async () => {
    const upload = guardUpload(
      request(JPEG, { 'content-type': 'image/png', 'x-file-name': 'a.png' }),
      limit,
    )
    await expect(read(upload.body)).rejects.toBeInstanceOf(ValidationError)
  })

  it('checks a body that arrives in small pieces', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < PNG.length; at += 3) {
          controller.enqueue(PNG.slice(at, at + 3))
        }
        controller.close()
      },
    })
    const upload = guardUpload(
      request(stream, { 'content-type': 'image/png', 'x-file-name': 'a.png' }),
      limit,
    )
    expect(await read(upload.body)).toEqual(PNG)
  })

  it('refuses a body too short to be an image', async () => {
    const upload = guardUpload(
      request(Uint8Array.from([0x89, 0x50]), {
        'content-type': 'image/png',
        'x-file-name': 'a.png',
      }),
      limit,
    )
    await expect(read(upload.body)).rejects.toBeInstanceOf(ValidationError)
  })
})
