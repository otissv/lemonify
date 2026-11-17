import { describe, expect, it, vi } from 'vitest'

import {
  EmailSendError,
  RESEND_ENDPOINT,
  ResendEmailSender,
} from './email-sender'

const EMAIL = {
  to: 'ann@example.com',
  subject: 'Hello',
  text: 'Hi',
  html: '<p>Hi</p>',
}

function sender(fetcher: typeof fetch, timeoutMs?: number): ResendEmailSender {
  return new ResendEmailSender({
    apiKey: 're_secret',
    from: 'Lemonify <hello@example.com>',
    fetch: fetcher,
    timeoutMs,
  })
}

describe('ResendEmailSender', () => {
  it('posts the email to Resend with the key as a bearer token', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response('{"id":"1"}', { status: 200 }),
    )

    await sender(fetcher).send(EMAIL)

    const [url, init] = fetcher.mock.calls[0] ?? []
    expect(url).toBe(RESEND_ENDPOINT)
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer re_secret',
    )
    expect(JSON.parse(String(init?.body))).toEqual({
      from: 'Lemonify <hello@example.com>',
      to: ['ann@example.com'],
      subject: 'Hello',
      text: 'Hi',
      html: '<p>Hi</p>',
    })
  })

  it('names the status and Resend’s reason when it refuses, and never the key', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response('{"message":"The domain is not verified"}', {
          status: 403,
        }),
    )

    const failure = await sender(fetcher)
      .send(EMAIL)
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(EmailSendError)
    expect((failure as Error).message).toBe(
      'Resend refused the email (status 403): The domain is not verified.',
    )
    expect((failure as Error).message).not.toContain('re_secret')
  })

  it('copes with an answer that is not JSON', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response('<html>', { status: 502 }),
    )

    await expect(sender(fetcher).send(EMAIL)).rejects.toThrow(
      'Resend refused the email (status 502): no reason given.',
    )
  })

  it('says Resend could not be reached when the request fails', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed')
    })

    await expect(sender(fetcher).send(EMAIL)).rejects.toThrow(
      'Resend could not be reached.',
    )
  })

  it('gives up after the time limit', async () => {
    const fetcher = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('timed out', 'TimeoutError'))
          })
        }),
    )

    await expect(sender(fetcher, 20).send(EMAIL)).rejects.toThrow(
      'Resend could not be reached.',
    )
  })
})
