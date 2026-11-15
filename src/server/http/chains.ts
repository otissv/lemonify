import {
  errorsMiddleware,
  publicMiddleware,
  sessionMiddleware,
} from './middleware.ts'
import type { RateLimitKind } from './rate-limiter.ts'

/**
 * The middleware every server function lists, as the plan's middleware table
 * requires. They are plain lists so each `createServerFn` call stays visible
 * to the Start compiler, which only strips server code from the browser
 * bundle for calls it can see.
 */
export function protectedChain(limit: RateLimitKind = 'default') {
  return [errorsMiddleware, sessionMiddleware(limit)] as const
}

/** For the few functions that must work before sign-in. */
export function publicChain(limit: RateLimitKind = 'default') {
  return [errorsMiddleware, publicMiddleware(limit)] as const
}

export const PROTECTED_CHAIN = protectedChain()
export const PUBLIC_CHAIN = publicChain()
