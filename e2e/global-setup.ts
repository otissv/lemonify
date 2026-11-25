import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { chromium } from '@playwright/test'

import { E2E_DATA_DIR, E2E_ORIGIN } from '../playwright.config.ts'
import { createApp } from '../src/server/composition.ts'
import { loadConfig } from '../src/server/config/config.ts'
import { seedDocuments } from './seed.ts'
import type { Manifest } from './seed.ts'

export const RUN_DIR = path.resolve('e2e/.run')
export const AUTH_FILE = path.join(RUN_DIR, 'auth.json')
export const MANIFEST_FILE = path.join(RUN_DIR, 'manifest.json')

export type ScratchAccount = {
  user: { name: string; email: string; password: string }
  authFile: string
  manifestFile: string
  cases: ReadonlyArray<string>
}

function scratchAccount(
  key: string,
  cases: ReadonlyArray<string>,
): ScratchAccount {
  return {
    user: {
      name: `Scratch ${key}`,
      email: `${key}@example.test`,
      password: `${key}-password-123`,
    },
    authFile: path.join(RUN_DIR, `auth-${key}.json`),
    manifestFile: path.join(RUN_DIR, `manifest-${key}.json`),
    cases,
  }
}

/**
 * Specs that change documents (reorder them, copy steps into them, rename them)
 * or watch another tab change them each get an account of their own with a few
 * documents. Everything else shares the main account, whose documents the
 * snapshot specs compare, so nothing may edit those.
 */
export const SCRATCH_ACCOUNTS = {
  live: scratchAccount('live', ['blur-default', 'scale-50', 'scale-150']),
  order: scratchAccount('order', ['blur-default', 'scale-50', 'scale-150']),
  copy: scratchAccount('copy', ['blur-default', 'scale-50']),
  groups: scratchAccount('groups', ['blur-default']),
  keys: scratchAccount('keys', ['blur-default']),
  canvas: scratchAccount('canvas', ['blur-default']),
  runs: scratchAccount('runs', ['blur-default']),
  workflowEditing: scratchAccount('workflow-editing', ['blur-default']),
  workflowRuns: scratchAccount('workflow-runs', ['blur-default']),
  workflowParity: scratchAccount('workflow-parity', ['blur-default']),
  api: scratchAccount('api', ['blur-default']),
  apiOther: scratchAccount('api-other', ['blur-default']),
} as const

export const E2E_USER = {
  name: 'End to end',
  email: 'e2e@example.test',
  password: 'e2e-password-123',
}

const SIGN_UP = `${E2E_ORIGIN}/api/auth/sign-up/email`

async function signUp(user: typeof E2E_USER): Promise<string> {
  const response = await fetch(SIGN_UP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: E2E_ORIGIN },
    body: JSON.stringify(user),
  })
  if (!response.ok) {
    throw new Error(
      `Sign-up failed: ${response.status} ${await response.text()}`,
    )
  }
  const cookies = response.headers.getSetCookie()
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ')
}

function writeAuthState(file: string, cookieHeader: string): void {
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
  writeFileSync(file, JSON.stringify({ cookies, origins: [] }))
}

const WARM_UP_TIMEOUT = 120_000
const PICTURE = '[data-slot="canvas"] img'

/**
 * Opens the home page and a document once, so the development server has
 * compiled every module those pages load before the specs start. Otherwise the
 * first specs pay for it, and wait past their timeouts for a page or a picture.
 */
async function warmUp(documentId: string): Promise<void> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ storageState: AUTH_FILE })
    page.setDefaultTimeout(WARM_UP_TIMEOUT)
    await page.goto(E2E_ORIGIN)
    await page.waitForLoadState('networkidle')
    await page.goto(`${E2E_ORIGIN}/documents/${documentId}`)
    await page.locator(PICTURE).first().waitFor()
    await page.waitForLoadState('networkidle')
  } finally {
    await browser.close()
  }
}

/**
 * Signs the test account up on the running server and fills its data with one
 * document per case. The server and this process share the data directory, as
 * the server and the command line do.
 */
export default async function globalSetup(): Promise<void> {
  mkdirSync(RUN_DIR, { recursive: true })
  writeAuthState(AUTH_FILE, await signUp(E2E_USER))
  for (const account of Object.values(SCRATCH_ACCOUNTS)) {
    writeAuthState(account.authFile, await signUp(account.user))
  }

  const config = loadConfig({ ...process.env, LEMONIFY_DATA_DIR: E2E_DATA_DIR })
  const app = await createApp(config)
  let manifest: Manifest
  try {
    manifest = await seedDocuments(app, E2E_USER.name)
    writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2))
    for (const account of Object.values(SCRATCH_ACCOUNTS)) {
      const seeded = await seedDocuments(app, account.user.name, account.cases)
      writeFileSync(account.manifestFile, JSON.stringify(seeded, null, 2))
    }
  } finally {
    await app.close()
  }

  const [firstDocument] = Object.values(manifest)
  if (firstDocument === undefined) throw new Error('No document was seeded.')
  await warmUp(firstDocument)
}
