import { describe, expect, it } from 'vitest'

import {
  ORIGIN_REJECTED,
  authFailureMessage,
} from '@/features/auth/auth-errors'

const FALLBACK = 'Could not sign in.'

describe('authFailureMessage', () => {
  it.each(['INVALID_ORIGIN', 'MISSING_OR_NULL_ORIGIN'])(
    'explains a rejected address for %s',
    (code) => {
      expect(
        authFailureMessage({ code, message: 'Invalid origin' }, FALLBACK),
      ).toBe(ORIGIN_REJECTED)
    },
  )

  it('keeps the server’s message for a wrong password', () => {
    expect(
      authFailureMessage(
        {
          code: 'INVALID_EMAIL_OR_PASSWORD',
          message: 'Invalid email or password',
        },
        FALLBACK,
      ),
    ).toBe('Invalid email or password')
  })

  it('uses the fallback when there is no message', () => {
    expect(authFailureMessage({}, FALLBACK)).toBe(FALLBACK)
  })

  it('says only that this address is not allowed, without naming settings', () => {
    expect(ORIGIN_REJECTED).toBe('This URL is not allowed to sign in.')
    expect(ORIGIN_REJECTED).not.toMatch(/LEMONIFY|_URL|origin/i)
  })
})
