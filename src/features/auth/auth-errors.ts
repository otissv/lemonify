const ORIGIN_CODES: ReadonlySet<string> = new Set([
  'INVALID_ORIGIN',
  'MISSING_OR_NULL_ORIGIN',
])

export const ORIGIN_REJECTED = 'This URL is not allowed to sign in.'

export type AuthError = {
  code?: string
  message?: string
}

/**
 * The words shown for a failed sign-in or sign-up. A rejected origin is a
 * setup problem rather than a wrong password, so it says what to change; any
 * other failure keeps the server's own message.
 */
export function authFailureMessage(error: AuthError, fallback: string): string {
  if (error.code !== undefined && ORIGIN_CODES.has(error.code)) {
    return ORIGIN_REJECTED
  }
  return error.message ?? fallback
}
