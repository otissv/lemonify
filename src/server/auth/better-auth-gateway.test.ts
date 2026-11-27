import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PostgresUserDao } from '../dao/postgres/user-dao'
import { createTestDatabase } from '../testing/test-database'
import { ValidationError } from '../errors'
import { MemoryLogger } from '../http/logger'
import { BetterAuthGateway } from './better-auth-gateway'

const ORIGIN = 'http://localhost:3000'
let gateway: BetterAuthGateway
let users: PostgresUserDao
let close: () => Promise<void>

beforeEach(async () => {
  const test = await createTestDatabase()
  const { database } = test
  users = new PostgresUserDao(database)
  gateway = new BetterAuthGateway({
    database: test.config,
    secret: 's'.repeat(32),
    baseUrl: ORIGIN,
    trustedOrigins: [ORIGIN],
    email: null,
    logger: new MemoryLogger(),
  })
  close = async () => {
    await gateway.close()
    await test.close()
  }
})

afterEach(async () => {
  await close()
})

async function signIn(email: string, password: string): Promise<Response> {
  return gateway.handle(
    new Request(`${ORIGIN}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email, password }),
    }),
  )
}

describe('BetterAuthGateway', () => {
  it('signs up an account and lists it as a User', async () => {
    const { userId } = await gateway.signUp({
      name: 'Ann',
      email: 'ann@example.com',
      password: 'correct horse battery',
    })
    const found = await users.findById(userId)
    expect(found).toMatchObject({ name: 'Ann', email: 'ann@example.com' })
  })

  it('accepts the reserved address used for the local CLI User', async () => {
    const { userId } = await gateway.signUp({
      name: 'local',
      email: 'local@lemonify.invalid',
      password: 'x'.repeat(64),
    })
    expect((await users.findById(userId))?.name).toBe('local')
  })

  it('refuses a short password and a taken email in plain words', async () => {
    await expect(
      gateway.signUp({ name: 'A', email: 'a@example.com', password: 'short' }),
    ).rejects.toThrow(ValidationError)
    await gateway.signUp({
      name: 'A',
      email: 'a@example.com',
      password: 'long enough password',
    })
    await expect(
      gateway.signUp({
        name: 'B',
        email: 'a@example.com',
        password: 'long enough password',
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('signs in through the handler and recognises the session cookie', async () => {
    const { userId } = await gateway.signUp({
      name: 'Ann',
      email: 'ann@example.com',
      password: 'correct horse battery',
    })
    const response = await signIn('ann@example.com', 'correct horse battery')
    expect(response.status).toBe(200)
    const cookie = response.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0])
      .join('; ')
    expect(cookie).toContain('lemonify.session_token')

    const actor = await gateway.getActor(new Headers({ cookie }))
    expect(actor).toEqual({ userId, name: 'Ann' })
  })

  it('knows nobody without a valid session', async () => {
    expect(await gateway.getActor(new Headers())).toBeNull()
    expect(
      await gateway.getActor(
        new Headers({ cookie: 'lemonify.session_token=nope' }),
      ),
    ).toBeNull()
  })

  it('rejects a wrong password', async () => {
    await gateway.signUp({
      name: 'Ann',
      email: 'ann@example.com',
      password: 'correct horse battery',
    })
    const response = await signIn('ann@example.com', 'wrong password!!')
    expect(response.status).toBe(401)
  })
})
