import { beforeEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({
  signIn: { email: vi.fn() },
  signUp: { email: vi.fn() },
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  sendVerificationEmail: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('better-auth/react', () => ({ createAuthClient: () => client }))

import {
  EMAIL_NOT_VERIFIED,
  requestPasswordReset,
  resendVerificationEmail,
  resetPassword,
  signInWithEmail,
  signUpWithEmail,
} from '@/features/auth/auth-client'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('signInWithEmail', () => {
  it('succeeds with no error', async () => {
    client.signIn.email.mockResolvedValue({ data: {}, error: null })

    expect(await signInWithEmail('a@x.com', 'pw')).toEqual({
      error: null,
      unverified: false,
    })
    expect(client.signIn.email).toHaveBeenCalledWith({
      email: 'a@x.com',
      password: 'pw',
      callbackURL: '/',
    })
  })

  it('says when the email has not been confirmed', async () => {
    client.signIn.email.mockResolvedValue({
      data: null,
      error: { code: EMAIL_NOT_VERIFIED, message: 'Email not verified' },
    })

    expect(await signInWithEmail('a@x.com', 'pw')).toEqual({
      error: 'Email not verified',
      unverified: true,
    })
  })

  it('keeps the server’s words for a wrong password', async () => {
    client.signIn.email.mockResolvedValue({
      data: null,
      error: {
        code: 'INVALID_EMAIL_OR_PASSWORD',
        message: 'Invalid email or password',
      },
    })

    expect(await signInWithEmail('a@x.com', 'no')).toEqual({
      error: 'Invalid email or password',
      unverified: false,
    })
  })
})

describe('signUpWithEmail', () => {
  it('is signed in at once when the server needs no confirmation', async () => {
    client.signUp.email.mockResolvedValue({
      data: { token: 'session', user: {} },
      error: null,
    })

    expect(await signUpWithEmail('Ann', 'a@x.com', 'pw')).toEqual({
      error: null,
      confirmEmail: false,
    })
  })

  it('has to confirm the email when the server gave no session', async () => {
    client.signUp.email.mockResolvedValue({
      data: { token: null, user: {} },
      error: null,
    })

    expect(await signUpWithEmail('Ann', 'a@x.com', 'pw')).toEqual({
      error: null,
      confirmEmail: true,
    })
  })

  it('does not ask to confirm when sign-up failed', async () => {
    client.signUp.email.mockResolvedValue({
      data: null,
      error: { message: 'User already exists' },
    })

    expect(await signUpWithEmail('Ann', 'a@x.com', 'pw')).toEqual({
      error: 'User already exists',
      confirmEmail: false,
    })
  })
})

describe('the emailed links', () => {
  it('asks for a reset link that leads back to the reset page', async () => {
    client.requestPasswordReset.mockResolvedValue({ data: {}, error: null })

    expect(await requestPasswordReset('a@x.com')).toEqual({ error: null })
    expect(client.requestPasswordReset).toHaveBeenCalledWith({
      email: 'a@x.com',
      redirectTo: '/reset-password',
    })
  })

  it('changes the password with the token from the link', async () => {
    client.resetPassword.mockResolvedValue({ data: {}, error: null })

    expect(await resetPassword('tok', 'new password')).toEqual({ error: null })
    expect(client.resetPassword).toHaveBeenCalledWith({
      token: 'tok',
      newPassword: 'new password',
    })
  })

  it('says why a reset failed, or falls back to plain words', async () => {
    client.resetPassword.mockResolvedValue({
      data: null,
      error: { message: 'Invalid token' },
    })
    expect(await resetPassword('bad', 'pw')).toEqual({ error: 'Invalid token' })

    client.resetPassword.mockResolvedValue({ data: null, error: {} })
    expect((await resetPassword('bad', 'pw')).error).toBe(
      'Could not change the password. Ask for a new link.',
    )
  })

  it('asks for the confirmation link again', async () => {
    client.sendVerificationEmail.mockResolvedValue({ data: {}, error: null })

    expect(await resendVerificationEmail('a@x.com')).toEqual({ error: null })
    expect(client.sendVerificationEmail).toHaveBeenCalledWith({
      email: 'a@x.com',
      callbackURL: '/',
    })
  })
})
