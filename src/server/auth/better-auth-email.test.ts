// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PostgresUserDao } from '../dao/postgres/user-dao'
import { createTestDatabase } from '../testing/test-database'
import { RecordingEmailSender } from '../email/email-sender'
import { MemoryLogger } from '../http/logger'
import { BetterAuthGateway } from './better-auth-gateway'

const ORIGIN = 'http://localhost:3000'
const ANN = {
  name: 'Ann',
  email: 'ann@example.com',
  password: 'correct horse battery',
}

let gateway: BetterAuthGateway
let emails: RecordingEmailSender
let logger: MemoryLogger
let users: PostgresUserDao
let close: () => Promise<void>

beforeEach(async () => {
  const test = await createTestDatabase()
  const { database } = test
  users = new PostgresUserDao(database)
  emails = new RecordingEmailSender()
  logger = new MemoryLogger()
  gateway = new BetterAuthGateway({
    database: test.config,
    secret: 's'.repeat(32),
    baseUrl: ORIGIN,
    trustedOrigins: [ORIGIN],
    email: emails,
    logger,
  })
  close = async () => {
    await gateway.close()
    await test.close()
  }
})

afterEach(async () => {
  await close()
})

function post(route: string, body: object): Promise<Response> {
  return gateway.handle(
    new Request(`${ORIGIN}/api/auth/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify(body),
    }),
  )
}

function signUp(): Promise<Response> {
  return post('sign-up/email', { ...ANN, callbackURL: '/' })
}

function signIn(password = ANN.password): Promise<Response> {
  return post('sign-in/email', {
    email: ANN.email,
    password,
    callbackURL: '/',
  })
}

async function link(address: string): Promise<string> {
  await expect.poll(() => emails.lastTo(address)).toBeDefined()
  const text = emails.lastTo(address)?.text ?? ''
  const found = /: (http\S+)/.exec(text)?.[1]
  if (found === undefined) throw new Error('The email has no link.')
  return found
}

function follow(url: string): Promise<Response> {
  return gateway.handle(new Request(url, { headers: { origin: ORIGIN } }))
}

describe('with email set up', () => {
  describe('signing up', () => {
    it('sends a confirmation link and does not sign the person in yet', async () => {
      const response = await signUp()

      expect(response.status).toBe(200)
      expect(response.headers.getSetCookie()).toEqual([])
      expect((await link(ANN.email)).startsWith(`${ORIGIN}/api/auth/`)).toBe(
        true,
      )
      expect(emails.lastTo(ANN.email)?.subject).toBe(
        'Confirm your email for Lemonify',
      )
    })

    it('refuses to sign in until the email is confirmed', async () => {
      await signUp()
      await link(ANN.email)

      const response = await signIn()

      expect(response.status).toBe(403)
      expect((await response.json()).code).toBe('EMAIL_NOT_VERIFIED')
      expect(response.headers.getSetCookie()).toEqual([])
    })

    it('sends the link again when asked', async () => {
      await signUp()
      await link(ANN.email)
      emails.sent.length = 0

      const response = await post('send-verification-email', {
        email: ANN.email,
        callbackURL: '/',
      })

      expect(response.status).toBe(200)
      await link(ANN.email)
    })

    it('confirms with the link, signs the person in, and lets them sign in after', async () => {
      await signUp()

      const confirmed = await follow(await link(ANN.email))

      expect(confirmed.status).toBeLessThan(400)
      expect(
        confirmed.headers.getSetCookie().some((c) => c.includes('lemonify')),
      ).toBe(true)
      expect((await signIn()).status).toBe(200)
    })

    it('does not accept a link that has been changed', async () => {
      await signUp()
      const url = await link(ANN.email)

      const response = await follow(url.replace(/token=([^&]+)/, 'token=$1x'))

      expect(response.headers.getSetCookie()).toEqual([])
      expect((await signIn()).status).toBe(403)
    })
  })

  describe('resetting a password', () => {
    async function confirmed(): Promise<void> {
      await signUp()
      await follow(await link(ANN.email))
      emails.sent.length = 0
    }

    function ask(email: string): Promise<Response> {
      return post('request-password-reset', {
        email,
        redirectTo: '/reset-password',
      })
    }

    function tokenOf(url: string): string {
      const token = /reset-password\/([^?]+)/.exec(url)?.[1]
      if (token === undefined) throw new Error('The link has no token.')
      return token
    }

    it('emails a link, and the new password works while the old one stops', async () => {
      await confirmed()

      expect((await ask(ANN.email)).status).toBe(200)
      const url = await link(ANN.email)
      expect(emails.lastTo(ANN.email)?.subject).toBe(
        'Reset your Lemonify password',
      )
      const reset = await post('reset-password', {
        newPassword: 'a brand new password',
        token: tokenOf(url),
      })

      expect(reset.status).toBe(200)
      expect((await signIn()).status).toBe(401)
      expect((await signIn('a brand new password')).status).toBe(200)
    })

    it('answers the same for an address with no account, and sends nothing', async () => {
      await confirmed()

      const known = await ask(ANN.email)
      const unknown = await ask('nobody@example.com')

      expect(unknown.status).toBe(known.status)
      expect(await unknown.json()).toEqual(await known.json())
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(emails.lastTo('nobody@example.com')).toBeUndefined()
    })

    it('does not accept a made-up token', async () => {
      await confirmed()

      const reset = await post('reset-password', {
        newPassword: 'a brand new password',
        token: 'made-up',
      })

      expect(reset.status).toBe(400)
      expect((await signIn()).status).toBe(200)
    })

    it('ends the sessions that were open, so a thief is signed out', async () => {
      await confirmed()
      const session = (await signIn()).headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; ')
      const before = await gateway.getActor(new Headers({ cookie: session }))
      expect(before).not.toBeNull()

      await ask(ANN.email)
      await post('reset-password', {
        newPassword: 'a brand new password',
        token: tokenOf(await link(ANN.email)),
      })

      expect(
        await gateway.getActor(new Headers({ cookie: session })),
      ).toBeNull()
    })
  })

  describe('when the email cannot be sent', () => {
    it('still answers as if it had, and logs why, so nothing is revealed', async () => {
      emails.failWith = new Error('Resend is down')

      const response = await signUp()

      expect(response.status).toBe(200)
      await expect
        .poll(() =>
          logger.lines.some((l) => l.message.includes('could not be sent')),
        )
        .toBe(true)
      const line = logger.lines.find((l) =>
        l.message.includes('could not be sent'),
      )
      expect(line?.fields).toEqual({
        kind: 'verification',
        reason: 'Resend is down',
      })
      expect(JSON.stringify(logger.lines)).not.toContain(ANN.email)
    })
  })

  it('creates an account for a trusted caller, such as the command line, with no email and already confirmed', async () => {
    const { userId } = await gateway.signUp(ANN)

    expect((await users.findById(userId))?.email).toBe(ANN.email)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(emails.sent).toEqual([])
    expect((await signIn()).status).toBe(200)
  })
})
