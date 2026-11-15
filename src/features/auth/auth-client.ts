import { createAuthClient } from 'better-auth/react'

import { authFailureMessage } from '@/features/auth/auth-errors'

/** Talks to the sign-in routes under `/api/auth` on the same origin. */
export const authClient = createAuthClient()

export type AuthResult = { error: string | null }

const SIGN_IN_FAILED = 'Could not sign in. Check your email and password.'
const SIGN_UP_FAILED = 'Could not create the account. Try again.'

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<AuthResult> {
  const { error } = await authClient.signIn.email({ email, password })
  return {
    error: error === null ? null : authFailureMessage(error, SIGN_IN_FAILED),
  }
}

export async function signUpWithEmail(
  name: string,
  email: string,
  password: string,
): Promise<AuthResult> {
  const { error } = await authClient.signUp.email({ name, email, password })
  return {
    error: error === null ? null : authFailureMessage(error, SIGN_UP_FAILED),
  }
}

export async function signOut(): Promise<void> {
  await authClient.signOut()
}
