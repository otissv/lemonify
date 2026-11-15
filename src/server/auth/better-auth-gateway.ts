import Database from 'better-sqlite3'
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'

import { applyPragmas } from '../database/connection.ts'
import type { Actor } from '../domain/actor.ts'
import { ValidationError } from '../errors.ts'
import type { AuthGateway, NewAccount } from './auth-gateway.ts'

export type BetterAuthOptions = {
  databaseFile: string
  secret: string
  baseUrl: string
  trustedOrigins: string[]
}

const COOKIE_PREFIX = 'lemonify'
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 128
const CLIENT_ERROR_STATUSES = new Set([400, 401, 403, 409, 422, 429])

/**
 * Better Auth keeps its own handle on the database file, next to Knex's, as
 * both are safe together in WAL mode. Its tables come from the migrations,
 * not from Better Auth, so there is one migration history.
 */
export class BetterAuthGateway implements AuthGateway {
  readonly #handle: Database.Database
  readonly #auth: ReturnType<typeof createAuthInstance>

  constructor(options: BetterAuthOptions) {
    this.#handle = new Database(options.databaseFile)
    applyPragmas(this.#handle)
    this.#auth = createAuthInstance(this.#handle, options)
  }

  async getActor(headers: Headers): Promise<Actor | null> {
    const session = await this.#auth.api.getSession({ headers })
    if (session === null) return null
    return { userId: session.user.id, name: session.user.name }
  }

  async signUp(account: NewAccount): Promise<{ userId: string }> {
    try {
      const created = await this.#auth.api.signUpEmail({ body: account })
      return { userId: created.user.id }
    } catch (error) {
      if (
        error instanceof APIError &&
        CLIENT_ERROR_STATUSES.has(Number(error.statusCode))
      ) {
        throw new ValidationError(error.message, { cause: error })
      }
      throw error
    }
  }

  handle(request: Request): Promise<Response> {
    return this.#auth.handler(request)
  }

  close(): void {
    this.#handle.close()
  }
}

function createAuthInstance(
  handle: Database.Database,
  options: BetterAuthOptions,
) {
  return betterAuth({
    database: handle,
    secret: options.secret,
    baseURL: options.baseUrl,
    trustedOrigins: options.trustedOrigins,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
    },
    advanced: { cookiePrefix: COOKIE_PREFIX },
  })
}
