import type { Actor } from '../domain/actor.ts'

export type NewAccount = {
  name: string
  email: string
  password: string
}

/**
 * What the app needs from the sign-in system. Better Auth is the one
 * implementation; services and middleware depend on this, so they can be
 * tested without it.
 */
export interface AuthGateway {
  /** The signed-in User for a request's headers, or null. */
  getActor(headers: Headers): Promise<Actor | null>
  /** Creates an account; the caller must keep the password to itself. */
  signUp(account: NewAccount): Promise<{ userId: string }>
  /** Handles the sign-in routes under `/api/auth`. */
  handle(request: Request): Promise<Response>
  close(): Promise<void>
}
