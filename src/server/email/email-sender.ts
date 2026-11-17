export type Email = {
  to: string
  subject: string
  text: string
  html: string
}

/** What the app needs to send an email; Resend is the one real implementation. */
export interface EmailSender {
  send(email: Email): Promise<void>
}

export class EmailSendError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EmailSendError'
  }
}

export type ResendOptions = {
  apiKey: string
  /** The sender, such as `Lemonify <hello@example.com>`; its domain must be verified in Resend. */
  from: string
  fetch?: typeof fetch
  timeoutMs?: number
}

export const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const DEFAULT_TIMEOUT_MS = 10_000

function resendMessage(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const { message } = body
    if (typeof message === 'string') return message
  }
  return 'no reason given'
}

/**
 * Sends through Resend's HTTP API with the platform's `fetch`, so there is no
 * client library to keep up to date. Every call has a time limit and a failure
 * names the status and Resend's reason, never the key.
 */
export class ResendEmailSender implements EmailSender {
  readonly #options: ResendOptions

  constructor(options: ResendOptions) {
    this.#options = options
  }

  async send(email: Email): Promise<void> {
    const { apiKey, from, timeoutMs = DEFAULT_TIMEOUT_MS } = this.#options
    const send = this.#options.fetch ?? fetch
    let response: Response
    try {
      response = await send(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
          html: email.html,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw new EmailSendError('Resend could not be reached.', {
        cause: error,
      })
    }
    if (response.ok) return
    const body: unknown = await response.json().catch(() => null)
    throw new EmailSendError(
      `Resend refused the email (status ${response.status}): ${resendMessage(body)}.`,
    )
  }
}

/** Remembers what it was asked to send, for tests. */
export class RecordingEmailSender implements EmailSender {
  readonly sent: Email[] = []
  failWith: Error | undefined

  async send(email: Email): Promise<void> {
    if (this.failWith) throw this.failWith
    this.sent.push(email)
  }

  lastTo(address: string): Email | undefined {
    for (const email of [...this.sent].reverse()) {
      if (email.to === address) return email
    }
    return undefined
  }
}
