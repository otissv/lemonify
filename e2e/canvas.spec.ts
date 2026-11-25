import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { SCRATCH_ACCOUNTS } from './global-setup.ts'
import type { Manifest } from './seed.ts'

const ACCOUNT = SCRATCH_ACCOUNTS.canvas
const manifest: Manifest = JSON.parse(
  readFileSync(ACCOUNT.manifestFile, 'utf8'),
)
const RENDER_TIMEOUT = 60_000
const PICTURE = '[data-slot="canvas"] img[src*="/renders/preview/"]'

test.use({ storageState: ACCOUNT.authFile })
test.describe.configure({ mode: 'serial' })

async function pictureSize(page: Page): Promise<[number, number]> {
  return page.locator(PICTURE).evaluate((image) => {
    const picture = image as HTMLImageElement
    return [picture.naturalWidth, picture.naturalHeight] as [number, number]
  })
}

async function newDocument(page: Page, name: string): Promise<void> {
  await page.goto('/')
  // The page answers clicks once React has hydrated it.
  await page.waitForLoadState('networkidle')
  await page.getByRole('menuitem', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: /New document/ }).click()
  const dialog = page.getByRole('dialog', { name: 'New document' })
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Width (px)').fill('320')
  await dialog.getByLabel('Height (px)').fill('200')
  await dialog.getByRole('button', { name: 'Create document' }).click()
  await expect(page).toHaveURL(/\/documents\//)
}

test('File > New document makes a blank document on the canvas chosen', async ({
  page,
}) => {
  await newDocument(page, 'Banner')

  await expect(page.locator(PICTURE)).toBeVisible({ timeout: RENDER_TIMEOUT })
  expect(await pictureSize(page)).toEqual([320, 200])
  await page.getByRole('tab', { name: 'Document' }).click()
  await expect(page.getByLabel('Width (px)')).toHaveValue('320')
  await expect(page.getByLabel('Height (px)')).toHaveValue('200')
})

test('the key for New document opens the dialog', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.keyboard.press('Alt+n')

  await expect(page.getByRole('dialog', { name: 'New document' })).toBeVisible()
})

test('the Document tab changes the canvas, the picture follows, and undo brings it back', async ({
  page,
}) => {
  await newDocument(page, 'Changing')
  await expect(page.locator(PICTURE)).toBeVisible({ timeout: RENDER_TIMEOUT })
  await page.getByRole('tab', { name: 'Document' }).click()

  await page.getByLabel('Width (px)').fill('400')
  await page.getByRole('button', { name: 'Change canvas' }).click()

  await expect
    .poll(() => pictureSize(page), { timeout: RENDER_TIMEOUT })
    .toEqual([400, 200])

  await page.keyboard.press('Control+z')
  await expect
    .poll(() => pictureSize(page), { timeout: RENDER_TIMEOUT })
    .toEqual([320, 200])
})

test('opening an image makes the canvas the size of that image, which a canvas change then keeps', async ({
  page,
}) => {
  const documentId = manifest['blur-default']
  if (documentId === undefined) throw new Error('No document to open.')
  await page.goto(`/documents/${documentId}`)
  await expect(page.locator(PICTURE)).toBeVisible({ timeout: RENDER_TIMEOUT })
  const [width, height] = await pictureSize(page)
  await page.getByRole('tab', { name: 'Document' }).click()
  await expect(page.getByLabel('Width (px)')).toHaveValue(String(width))
  await expect(page.getByLabel('Height (px)')).toHaveValue(String(height))
})
