import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { SCRATCH_ACCOUNTS } from './global-setup.ts'
import type { Manifest } from './seed.ts'

const ACCOUNT = SCRATCH_ACCOUNTS.keys
const manifest: Manifest = JSON.parse(
  readFileSync(ACCOUNT.manifestFile, 'utf8'),
)
const SOURCE_NAME = 'blur-default'
const RENDER_TIMEOUT = 60_000

test.use({ storageState: ACCOUNT.authFile })

async function openDocument(page: Page): Promise<void> {
  const documentId = manifest[SOURCE_NAME]
  if (documentId === undefined) throw new Error('No document to open.')
  await page.goto(`/documents/${documentId}`)
  await expect(
    page.locator('[data-slot="canvas"] img[src*="/renders/preview/"]'),
  ).toBeVisible({ timeout: RENDER_TIMEOUT })
  await expect(page.getByRole('tab', { name: 'Tools' })).toBeVisible()
}

async function selected(page: Page, tab: string): Promise<void> {
  await expect(page.getByRole('tab', { name: tab })).toHaveAttribute(
    'aria-selected',
    'true',
  )
}

async function showShortcuts(page: Page): Promise<void> {
  await page.keyboard.press('Shift+Slash')
  await expect(
    page.getByRole('dialog', { name: 'Keyboard shortcuts' }),
  ).toBeVisible()
}

test.describe.configure({ mode: 'serial' })

test('the default keys work: panels, the shortcuts dialog and a tool', async ({
  page,
}) => {
  await openDocument(page)

  await page.keyboard.press('Alt+5')
  await selected(page, 'Document')
  await page.keyboard.press('Alt+1')
  await selected(page, 'Tools')

  await page
    .getByRole('button', { name: `Show steps of ${SOURCE_NAME}` })
    .click()
  const steps = page.getByRole('list', {
    name: `Steps of ${SOURCE_NAME}`,
    exact: true,
  })
  const blurs = steps.getByRole('button', { name: 'Blur', exact: true })
  await expect(blurs).toHaveCount(1)
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('KeyB')
  await expect(blurs).toHaveCount(2)
  await page.keyboard.press('Control+KeyZ')
  await expect(blurs).toHaveCount(1)

  await showShortcuts(page)
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog.getByText('Show Document')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('a key the browser keeps is refused, and a key another action has needs a say-so', async ({
  page,
}) => {
  await openDocument(page)
  await showShortcuts(page)
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  const row = dialog.locator('[data-action="view.fit"]')

  await row.getByRole('button', { name: /Change the key/ }).click()
  await page.keyboard.press('Control+KeyW')
  await expect(dialog.getByRole('alert')).toContainText('kept by the browser')

  await row.getByRole('button', { name: /Change the key/ }).click()
  await page.keyboard.press('Control+KeyZ')
  await expect(dialog.getByRole('alert')).toContainText(
    'already belongs to Undo',
  )
  await dialog.getByRole('button', { name: 'Keep it there' }).click()
  await expect(row.getByText('0', { exact: true })).toBeVisible()
})

test('a key the person chooses is kept on the server, and the one given up stops working', async ({
  page,
}) => {
  await openDocument(page)
  await showShortcuts(page)
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  const row = dialog.locator('[data-action="panel.document"]')

  await row.getByRole('button', { name: /Change the key/ }).click()
  await page.keyboard.press('Alt+8')
  await expect(row.getByText('Alt+8')).toBeVisible()
  await expect(
    row.getByRole('button', { name: /default keys back/ }),
  ).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  await page.keyboard.press('Alt+1')
  await selected(page, 'Tools')
  await page.keyboard.press('Alt+5')
  await selected(page, 'Tools')
  await page.keyboard.press('Alt+8')
  await selected(page, 'Document')

  await page.reload()
  await expect(page.getByRole('tab', { name: 'Tools' })).toBeVisible()
  await page.keyboard.press('Alt+1')
  await selected(page, 'Tools')
  await page.keyboard.press('Alt+8')
  await selected(page, 'Document')

  await showShortcuts(page)
  await dialog
    .locator('[data-action="panel.document"]')
    .getByRole('button', { name: /default keys back/ })
    .click()
  await expect(
    dialog.locator('[data-action="panel.document"]').getByText('Alt+5'),
  ).toBeVisible()
})
