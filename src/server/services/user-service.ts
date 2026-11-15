import { randomBytes } from 'node:crypto'

import type { AuthGateway } from '../auth/auth-gateway.ts'
import type { UserDao, UserRecord } from '../dao/user-dao.ts'
import type { Actor } from '../domain/actor.ts'
import { NotFoundError, ValidationError } from '../errors.ts'

export const LOCAL_USER = {
  name: 'local',
  email: 'local@lemonify.invalid',
} as const

const LOCAL_PASSWORD_BYTES = 32

type UserServiceDependencies = {
  users: UserDao
  auth: Pick<AuthGateway, 'signUp'>
}

/**
 * Who the CLI acts as. Users sign up on the website; the CLI picks one of
 * them, and only on a machine with no Users at all does it create the one
 * local User, with a password nobody ever sees.
 */
export class UserService {
  readonly #users: UserDao
  readonly #auth: Pick<AuthGateway, 'signUp'>

  constructor({ users, auth }: UserServiceDependencies) {
    this.#users = users
    this.#auth = auth
  }

  list(): Promise<UserRecord[]> {
    return this.#users.list()
  }

  async resolveActor(userName?: string): Promise<Actor> {
    if (userName !== undefined) return this.#named(userName)
    const users = await this.#users.list()
    const [only, second] = users
    if (only === undefined) return this.#createLocalUser()
    if (second === undefined) return toActor(only)
    throw new ValidationError(
      'There is more than one user. Choose one with --user <name>; `lemonify user list` shows them.',
    )
  }

  async #named(value: string): Promise<Actor> {
    const matches = await this.#users.findByNameOrEmail(value)
    const [match, other] = matches
    if (match === undefined) {
      throw new NotFoundError(
        `There is no user "${value}". \`lemonify user list\` shows the users.`,
      )
    }
    if (other !== undefined) {
      throw new ValidationError(
        `More than one user is called "${value}". Use the email address instead.`,
      )
    }
    return toActor(match)
  }

  async #createLocalUser(): Promise<Actor> {
    const password = randomBytes(LOCAL_PASSWORD_BYTES).toString('hex')
    const { userId } = await this.#auth.signUp({ ...LOCAL_USER, password })
    return { userId, name: LOCAL_USER.name }
  }
}

function toActor(user: UserRecord): Actor {
  return { userId: user.id, name: user.name }
}
