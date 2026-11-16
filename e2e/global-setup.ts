import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { E2E_DATA_DIR, E2E_ORIGIN } from '../playwright.config.ts'
import { createApp } from '../src/server/composition.ts'
import { loadConfig } from '../src/server/config/config.ts'
import { seedDocuments } from './seed.ts'

export const RUN_DIR = path.resolve('e2e/.run')
export const AUTH_FILE = path.join(RUN_DIR, 'auth.json')
export const MANIFEST_FILE = path.join(RUN_DIR, 'manifest.json')

export const E2E_USER = {
  name: 'End to end',
  email: 'e2e@example.test',
  password: 'e2e-password-123',
}

const SIGN_UP = `${E2E_ORIGIN}/api/auth/sign-up/email`

async function signUp(): Promise<string> {
  const response = await fetch(SIGN_UP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: E2E_ORIGIN },
    body: JSON.stringify(E2E_USER),
  })
  if (!response.ok) {
    throw new Error(
      `Sign-up failed: ${response.status} ${await response.text()}`,
    )
  }
  const cookies = response.headers.getSetCookie()
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ')
}

function writeAuthState(cookieHeader: string): void {
  const { hostname } = new URL(E2E_ORIGIN)
  const cookies = cookieHeader.split('; ').map((pair) => {
    const separator = pair.indexOf('=')
    return {
      name: pair.slice(0, separator),
      value: pair.slice(separator + 1),
      domain: hostname,
      path: '/',
      expires: -1,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax' as const,
    }
  })
  writeFileSync(AUTH_FILE, JSON.stringify({ cookies, origins: [] }))
}

/**
 * Signs the test account up on the running server and fills its data with one
 * document per case. The server and this process share the data directory, as
 * the server and the command line do.
 */
export default async function globalSetup(): Promise<void> {
  mkdirSync(RUN_DIR, { recursive: true })
  writeAuthState(await signUp())

  const config = loadConfig({ ...process.env, LEMONIFY_DATA_DIR: E2E_DATA_DIR })
  const app = await createApp(config)
  try {
    const manifest = await seedDocuments(app, E2E_USER.name)
    writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2))
  } finally {
    await app.close()
  }
}
