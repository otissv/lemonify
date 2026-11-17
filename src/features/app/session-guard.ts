import { redirect } from '@tanstack/react-router'

import type { Actor } from '@/server/domain/actor'

export const SIGN_IN_PATH = '/sign-in'
export const RESET_PASSWORD_PATH = '/reset-password'

/** Pages that work with nobody signed in, and that a signed-in User has no use for. */
const SIGNED_OUT_PATHS: ReadonlySet<string> = new Set([
  SIGN_IN_PATH,
  RESET_PASSWORD_PATH,
])

/**
 * Where a visitor must go for the page they asked for: nobody signed in
 * goes to the sign-in page, and a signed-in User never sees it.
 */
export function guardSession(actor: Actor | null, pathname: string): void {
  const signedOutPage = SIGNED_OUT_PATHS.has(pathname)
  if (actor === null && !signedOutPage) throw redirect({ to: SIGN_IN_PATH })
  if (actor !== null && signedOutPage) throw redirect({ to: '/' })
}
