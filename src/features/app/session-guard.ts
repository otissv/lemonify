import { redirect } from '@tanstack/react-router'

import type { Actor } from '@/server/domain/actor'

export const SIGN_IN_PATH = '/sign-in'

/**
 * Where a visitor must go for the page they asked for: nobody signed in
 * goes to the sign-in page, and a signed-in User never sees it.
 */
export function guardSession(actor: Actor | null, pathname: string): void {
  const onSignIn = pathname === SIGN_IN_PATH
  if (actor === null && !onSignIn) throw redirect({ to: SIGN_IN_PATH })
  if (actor !== null && onSignIn) throw redirect({ to: '/' })
}
