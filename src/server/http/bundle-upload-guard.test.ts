// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { LimitError, ValidationError } from '../errors.ts'
import { guardBundleUpload } from './bundle-upload-guard.ts'

function request(headers: Record<string, string>, body: string | null) {
  return new Request('http://localhost/api/documents/import', {
    method: 'POST',
    headers,
    body,
  })
}

describe('guardBundleUpload', () => {
  it('hands back the body of a zip upload', async () => {
    const body = guardBundleUpload(
      request({ 'content-type': 'application/zip' }, 'bytes'),
      100,
    )

    const chunks: Uint8Array[] = []
    for await (const chunk of body) chunks.push(chunk)
    expect(Buffer.concat(chunks).toString()).toBe('bytes')
  })

  it('refuses any other type', () => {
    expect(() =>
      guardBundleUpload(request({ 'content-type': 'text/html' }, 'x'), 100),
    ).toThrow(ValidationError)
    expect(() => guardBundleUpload(request({}, 'x'), 100)).toThrow(
      ValidationError,
    )
  })

  it('refuses a request with no body', () => {
    expect(() =>
      guardBundleUpload(
        request({ 'content-type': 'application/zip' }, null),
        100,
      ),
    ).toThrow(ValidationError)
  })

  it('refuses a body that says it is larger than the limit', () => {
    expect(() =>
      guardBundleUpload(
        request(
          { 'content-type': 'application/zip', 'content-length': '101' },
          'x',
        ),
        100,
      ),
    ).toThrow(LimitError)
  })
})
