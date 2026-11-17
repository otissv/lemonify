import { isRedirect } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'

import { guardSession } from '@/features/app/session-guard'

const ACTOR = { userId: 'u1', name: 'Ann' }

function redirectTarget(run: () => void): string | null {
  try {
    run()
  } catch (error) {
    if (isRedirect(error)) return String(error.options.to)
    throw error
  }
  return null
}

describe('guardSession', () => {
  it('sends a visitor who is not signed in to the sign-in page', () => {
    expect(redirectTarget(() => guardSession(null, '/documents/abc'))).toBe(
      '/sign-in',
    )
    expect(redirectTarget(() => guardSession(null, '/'))).toBe('/sign-in')
  })

  it('lets a visitor who is not signed in see the sign-in page', () => {
    expect(redirectTarget(() => guardSession(null, '/sign-in'))).toBeNull()
  })

  it('sends a signed-in User away from the sign-in page', () => {
    expect(redirectTarget(() => guardSession(ACTOR, '/sign-in'))).toBe('/')
  })

  it('lets a visitor who is not signed in open the link from a reset email', () => {
    expect(
      redirectTarget(() => guardSession(null, '/reset-password')),
    ).toBeNull()
  })

  it('sends a signed-in User away from the reset page too', () => {
    expect(redirectTarget(() => guardSession(ACTOR, '/reset-password'))).toBe(
      '/',
    )
  })

  it('lets a signed-in User see every other page', () => {
    expect(
      redirectTarget(() => guardSession(ACTOR, '/documents/abc')),
    ).toBeNull()
  })
})
