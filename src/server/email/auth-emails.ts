import type { Email } from './email-sender.ts'

export type AuthEmail = Omit<Email, 'to'>

export type AuthEmailInput = {
  name: string
  /** The one-time link the person follows. */
  url: string
  expiresInMinutes: number
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? '')
}

type Content = {
  subject: string
  greeting: string
  lines: ReadonlyArray<string>
  action: string
  ignore: string
}

function render(content: Content, input: AuthEmailInput): AuthEmail {
  const expires = `The link works for ${input.expiresInMinutes} minutes.`
  const text = [
    content.greeting,
    '',
    ...content.lines,
    '',
    `${content.action}: ${input.url}`,
    '',
    expires,
    content.ignore,
  ].join('\n')
  const paragraphs = content.lines
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')
  const html = [
    `<p>${escapeHtml(content.greeting)}</p>`,
    paragraphs,
    `<p><a href="${escapeHtml(input.url)}">${escapeHtml(content.action)}</a></p>`,
    `<p>${escapeHtml(expires)}</p>`,
    `<p>${escapeHtml(content.ignore)}</p>`,
  ].join('')
  return { subject: content.subject, text, html }
}

export function verificationEmail(input: AuthEmailInput): AuthEmail {
  return render(
    {
      subject: 'Confirm your email for Lemonify',
      greeting: `Hi ${input.name},`,
      lines: ['Confirm your email address to finish creating your account.'],
      action: 'Confirm your email',
      ignore: 'If you did not create an account, you can ignore this email.',
    },
    input,
  )
}

export function passwordResetEmail(input: AuthEmailInput): AuthEmail {
  return render(
    {
      subject: 'Reset your Lemonify password',
      greeting: `Hi ${input.name},`,
      lines: ['Someone asked to reset the password for your account.'],
      action: 'Choose a new password',
      ignore:
        'If it was not you, ignore this email: your password stays as it is.',
    },
    input,
  )
}
