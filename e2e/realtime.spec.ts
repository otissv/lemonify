import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import WebSocket from 'ws'

import { E2E_ORIGIN, E2E_REALTIME_URL } from '../playwright.config.ts'
import { SCRATCH_ACCOUNTS } from './global-setup.ts'
import type { Manifest } from './seed.ts'

const ACCOUNT = SCRATCH_ACCOUNTS.live
const manifest: Manifest = JSON.parse(
  readFileSync(ACCOUNT.manifestFile, 'utf8'),
)
const SOURCE_NAME = 'blur-default'

test.use({ storageState: ACCOUNT.authFile })

function documentId(name: string): string {
  const id = manifest[name]
  if (id === undefined) throw new Error(`No document called ${name}.`)
  return id
}

async function open(page: Page, id: string): Promise<void> {
  await page.goto(`/documents/${id}`)
  await expect(page.locator('[data-slot="canvas"] img')).toBeVisible()
}

function sessionCookies(): string {
  const { cookies } = JSON.parse(readFileSync(ACCOUNT.authFile, 'utf8')) as {
    cookies: ReadonlyArray<{ name: string; value: string }>
  }
  return cookies.map(({ name, value }) => `${name}=${value}`).join('; ')
}

/** What a connection attempt ends in: the status it was refused with, or "open" if it was let in. */
function attempt(headers: Record<string, string>): Promise<number | 'open'> {
  return new Promise((resolve) => {
    const socket = new WebSocket(E2E_REALTIME_URL, { headers })
    socket.on('open', () => {
      socket.close()
      resolve('open')
    })
    socket.on('unexpected-response', (_request, response) => {
      resolve(response.statusCode ?? 0)
      socket.terminate()
    })
    socket.on('error', () => undefined)
  })
}

test.describe('two tabs of the same account', () => {
  test('show a rename made in the other tab', async ({ context }) => {
    const id = documentId('scale-50')
    const first = await context.newPage()
    const second = await context.newPage()
    await open(first, id)
    await open(second, id)
    const original =
      (await first
        .getByRole('link', { name: /scale-50/ })
        .first()
        .textContent()) ?? ''
    const renamed = `${original} live`

    try {
      await first.getByRole('link', { name: original, exact: true }).dblclick()
      await first.getByRole('textbox', { name: 'Document name' }).fill(renamed)
      await first.keyboard.press('Enter')

      await expect(
        second.getByRole('link', { name: renamed, exact: true }),
      ).toBeVisible()
    } finally {
      const link = first.getByRole('link', { name: renamed, exact: true })
      if (await link.count()) {
        await link.dblclick()
        await first
          .getByRole('textbox', { name: 'Document name' })
          .fill(original)
        await first.keyboard.press('Enter')
        await expect(
          second.getByRole('link', { name: original, exact: true }),
        ).toBeVisible()
      }
    }
  })

  test('show a step added in the other tab, without a reload', async ({
    context,
  }) => {
    const source = await context.newPage()
    const watcher = await context.newPage()
    await open(source, documentId(SOURCE_NAME))
    await source
      .getByRole('button', { name: `Show steps of ${SOURCE_NAME}` })
      .click()
    const blur = source
      .getByRole('list', { name: `Steps of ${SOURCE_NAME}`, exact: true })
      .getByRole('button', { name: 'Blur', exact: true })
      .locator('xpath=ancestor::li[1]')
    const next = source
      .getByRole('link', { name: SOURCE_NAME, exact: true })
      .locator('xpath=ancestor::li[1]/following-sibling::li[1]')
    const targetName = (await next.getByRole('link').textContent()) ?? ''
    const targetId = ((await next.getByRole('link').getAttribute('href')) ?? '')
      .split('/')
      .pop()
    expect(targetId).toBeTruthy()

    await open(watcher, targetId ?? '')
    await watcher
      .getByRole('button', { name: `Show steps of ${targetName}`, exact: true })
      .click()
    const before = await watcher
      .getByRole('list', { name: `Steps of ${targetName}`, exact: true })
      .getByRole('button', { name: 'Blur', exact: true })
      .count()

    await blur.dragTo(next, { sourcePosition: { x: 3, y: 3 } })

    await expect(
      watcher
        .getByRole('list', { name: `Steps of ${targetName}`, exact: true })
        .getByRole('button', { name: 'Blur', exact: true }),
    ).toHaveCount(before + 1, { timeout: 15_000 })
  })
})

test.describe('the live connection', () => {
  test('lets in the signed-in person from this site', async () => {
    expect(
      await attempt({ Origin: E2E_ORIGIN, Cookie: sessionCookies() }),
    ).toBe('open')
  })

  test('refuses a page from another site, even with the person’s cookie', async () => {
    expect(
      await attempt({
        Origin: 'https://evil.example',
        Cookie: sessionCookies(),
      }),
    ).toBe(403)
  })

  test('refuses a connection with no origin', async () => {
    expect(await attempt({ Cookie: sessionCookies() })).toBe(403)
  })

  test('refuses someone who is not signed in', async () => {
    expect(await attempt({ Origin: E2E_ORIGIN })).toBe(401)
  })

  test('refuses a forged session', async () => {
    expect(
      await attempt({
        Origin: E2E_ORIGIN,
        Cookie: 'better-auth.session_token=forged.value',
      }),
    ).toBe(401)
  })
})
