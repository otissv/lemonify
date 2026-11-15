import { Readable } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { attachment, streamResponse } from './stream-response.ts'

describe('streamResponse', () => {
  it('streams the bytes with safe headers', async () => {
    const response = streamResponse({
      stream: Readable.from([Buffer.from('abc')]),
      mediaType: 'image/png',
      bytes: 3,
      immutable: true,
    })
    expect(await response.text()).toBe('abc')
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-length')).toBe('3')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    expect(response.headers.get('cache-control')).toContain('private')
    expect(response.headers.get('cache-control')).toContain('immutable')
    expect(response.headers.get('content-disposition')).toBeNull()
  })

  it('does not cache what can change', () => {
    const response = streamResponse({
      stream: Readable.from([]),
      mediaType: 'image/png',
      immutable: false,
    })
    expect(response.headers.get('cache-control')).toBe('private, no-cache')
    expect(response.headers.get('content-length')).toBeNull()
  })

  it('offers a download under a name', () => {
    const response = streamResponse({
      stream: Readable.from([]),
      mediaType: 'image/webp',
      downloadAs: 'cat.webp',
      immutable: false,
    })
    expect(response.headers.get('content-disposition')).toContain('attachment')
  })
})

describe('attachment', () => {
  it('keeps a plain name', () => {
    expect(attachment('cat.webp')).toBe(
      `attachment; filename="cat.webp"; filename*=UTF-8''cat.webp`,
    )
  })

  it('cannot be used to inject headers or break the quoting', () => {
    const header = attachment('a"b\r\nSet-Cookie: x=1;%.png')
    expect(header).not.toMatch(/[\r\n]/)
    expect(header.split('filename="')[1]?.split('"')[0]).toBe(
      'a_b__Set-Cookie: x=1__.png'.replace(': ', ': '),
    )
  })

  it('encodes a name outside ASCII for browsers that read it', () => {
    expect(attachment('café.png')).toContain("filename*=UTF-8''caf%C3%A9.png")
    expect(attachment('café.png')).toContain('filename="caf_.png"')
  })
})
