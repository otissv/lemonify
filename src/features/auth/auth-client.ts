import { createAuthClient } from 'better-auth/react'

import { authFailureMessage } from '@/features/auth/auth-errors'
import { RESET_PASSWORD_PATH } from '@/features/app/session-guard'

/** Talks to the sign-in routes under `/api/auth` on the same origin. */
export const authClient = createAuthClient()

export type AuthResult = { error: string | null }
export type SignInResult = AuthResult & {
  /** The password was right but the email has not been confirmed. */
  unverified: boolean
}
export type SignUpResult = AuthResult & {
  /** The account exists but cannot be used until the emailed link is followed. */
  confirmEmail: boolean
}

export const EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED'
const HOME_PATH = '/'

const SIGN_IN_FAILED = 'Could not sign in. Check your email and password.'
const SIGN_UP_FAILED = 'Could not create the account. Try again.'
const EMAIL_FAILED = 'Could not send the email. Try again in a few minutes.'
const RESET_FAILED = 'Could not change the password. Ask for a new link.'

function failure(
  error: { code?: string; message?: string } | null,
  fallback: string,
): AuthResult {
  return { error: error === null ? null : authFailureMessage(error, fallback) }
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<SignInResult> {
  const { error } = await authClient.signIn.email({
    email,
    password,
    callbackURL: HOME_PATH,
  })
  return {
    ...failure(error, SIGN_IN_FAILED),
    unverified: error?.code === EMAIL_NOT_VERIFIED,
  }
}

export async function signUpWithEmail(
  name: string,
  email: string,
  password: string,
): Promise<SignUpResult> {
  const { data, error } = await authClient.signUp.email({
    name,
    email,
    password,
    callbackURL: HOME_PATH,
  })
  return {
    ...failure(error, SIGN_UP_FAILED),
    confirmEmail: error === null && data?.token === null,
  }
}

/** Asks for a reset link. The answer is the same whether or not the address has an account. */
export async function requestPasswordReset(email: string): Promise<AuthResult> {
  const { error } = await authClient.requestPasswordReset({
    email,
    redirectTo: RESET_PASSWORD_PATH,
  })
  return failure(error, EMAIL_FAILED)
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<AuthResult> {
  const { error } = await authClient.resetPassword({ token, newPassword })
  return failure(error, RESET_FAILED)
}

export async function resendVerificationEmail(
  email: string,
): Promise<AuthResult> {
  const { error } = await authClient.sendVerificationEmail({
    email,
    callbackURL: HOME_PATH,
  })
  return failure(error, EMAIL_FAILED)
}

export async function signOut(): Promise<void> {
  await authClient.signOut()
}
