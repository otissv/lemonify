import { describe, expect, it } from 'vitest'

import {
  escapeHtml,
  passwordResetEmail,
  verificationEmail,
} from './auth-emails'
import { DEFAULT_SITE_ORIGIN } from '../config/site-port'

const INPUT = {
  name: 'Ann',
  url: `${DEFAULT_SITE_ORIGIN}/api/auth/verify-email?token=abc&callbackURL=%2F`,
  expiresInMinutes: 60,
}

describe('escapeHtml', () => {
  it('escapes what could break out of text or an attribute', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    )
  })
})

describe('verificationEmail', () => {
  it('asks for confirmation and gives the link in both forms', () => {
    const email = verificationEmail(INPUT)

    expect(email.subject).toBe('Confirm your email for Lemonify')
    expect(email.text).toContain(`Confirm your email: ${INPUT.url}`)
    expect(email.text).toContain('The link works for 60 minutes.')
    expect(email.html).toContain(
      `href="${escapeHtml(INPUT.url)}">Confirm your email</a>`,
    )
  })

  it('cannot be made to carry markup through the name', () => {
    const email = verificationEmail({
      ...INPUT,
      name: '<script>alert(1)</script>',
    })

    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;')
  })
})

describe('passwordResetEmail', () => {
  it('offers the link and says what to do if it was not asked for', () => {
    const email = passwordResetEmail(INPUT)

    expect(email.subject).toBe('Reset your Lemonify password')
    expect(email.text).toContain(`Choose a new password: ${INPUT.url}`)
    expect(email.text).toContain('ignore this email')
    expect(email.html).toContain('Choose a new password</a>')
  })
})
