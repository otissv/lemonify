import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import pg from 'pg'

import { MIN_PASSWORD_LENGTH } from '@/features/auth/password-rules'
import type { DatabaseConfig } from '../config/config.ts'
import { connectionSettings } from '../database/connection.ts'
import type { Actor } from '../domain/actor.ts'
import { ValidationError } from '../errors.ts'
import { passwordResetEmail, verificationEmail } from '../email/auth-emails.ts'
import type { AuthEmail } from '../email/auth-emails.ts'
import type { EmailSender } from '../email/email-sender.ts'
import type { Logger } from '../http/logger.ts'
import type { AuthGateway, NewAccount } from './auth-gateway.ts'

export type BetterAuthOptions = {
  database: DatabaseConfig
  secret: string
  baseUrl: string
  trustedOrigins: string[]
  /** Where verification and password-reset emails go; null turns both off. */
  email: EmailSender | null
  logger: Logger
}

const COOKIE_PREFIX = 'lemonify'
const MAX_PASSWORD_LENGTH = 128
/** How long an emailed link works. */
export const EMAIL_LINK_SECONDS = 3600
const SECONDS_PER_MINUTE = 60
const CLIENT_ERROR_STATUSES = new Set([400, 401, 403, 409, 422, 429])

/**
 * Better Auth keeps its own pool on the database, next to Knex's, with the
 * driver's own ways of reading values, which it expects. Its tables come from
 * the migrations, not from Better Auth, so there is one migration history.
 */
export class BetterAuthGateway implements AuthGateway {
  readonly #pool: pg.Pool
  readonly #auth: ReturnType<typeof createAuthInstance>
  /** Creates accounts for trusted callers, so it never sends mail. */
  readonly #accounts: ReturnType<typeof createAuthInstance>

  constructor(options: BetterAuthOptions) {
    this.#pool = new pg.Pool({
      ...connectionSettings(options.database),
      max: options.database.poolSize,
    })
    this.#auth = createAuthInstance(this.#pool, options)
    this.#accounts = createAuthInstance(this.#pool, {
      ...options,
      email: null,
    })
  }

  async getActor(headers: Headers): Promise<Actor | null> {
    const session = await this.#auth.api.getSession({ headers })
    if (session === null) return null
    return { userId: session.user.id, name: session.user.name }
  }

  /**
   * For callers that vouch for the address, such as the command line: the
   * account is confirmed from the start and no email is sent. People sign up
   * through the website's own route, which does confirm.
   */
  async signUp(account: NewAccount): Promise<{ userId: string }> {
    try {
      const created = await this.#accounts.api.signUpEmail({ body: account })
      await this.#pool.query(
        'UPDATE "user" SET "emailVerified" = true WHERE id = $1',
        [created.user.id],
      )
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

  close(): Promise<void> {
    return this.#pool.end()
  }
}

type Recipient = { name: string; email: string }

/**
 * Sends in the background and only logs a failure. Awaiting would make the
 * response slower for an address that has an account than for one that does
 * not, which tells a stranger who is registered.
 */
function deliverInBackground(
  options: BetterAuthOptions,
  sender: EmailSender,
  kind: string,
  recipient: Recipient,
  build: (input: Parameters<typeof verificationEmail>[0]) => AuthEmail,
  url: string,
): void {
  const content = build({
    name: recipient.name,
    url,
    expiresInMinutes: EMAIL_LINK_SECONDS / SECONDS_PER_MINUTE,
  })
  sender.send({ to: recipient.email, ...content }).catch((error: unknown) => {
    options.logger.error('email could not be sent', {
      kind,
      reason: error instanceof Error ? error.message : String(error),
    })
  })
}

function createAuthInstance(pool: pg.Pool, options: BetterAuthOptions) {
  const sender = options.email
  return betterAuth({
    database: pool,
    secret: options.secret,
    baseURL: options.baseUrl,
    trustedOrigins: options.trustedOrigins,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: sender !== null,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      resetPasswordTokenExpiresIn: EMAIL_LINK_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword:
        sender === null
          ? undefined
          : async ({ user, url }) => {
              deliverInBackground(
                options,
                sender,
                'password reset',
                user,
                passwordResetEmail,
                url,
              )
            },
    },
    emailVerification:
      sender === null
        ? undefined
        : {
            sendOnSignUp: true,
            autoSignInAfterVerification: true,
            expiresIn: EMAIL_LINK_SECONDS,
            sendVerificationEmail: async ({ user, url }) => {
              deliverInBackground(
                options,
                sender,
                'verification',
                user,
                verificationEmail,
                url,
              )
            },
          },
    advanced: { cookiePrefix: COOKIE_PREFIX },
  })
}
