import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { SCRATCH_ACCOUNTS } from './global-setup.ts'
import type { Manifest } from './seed.ts'

const ACCOUNT = SCRATCH_ACCOUNTS.order
const manifest: Manifest = JSON.parse(
  readFileSync(ACCOUNT.manifestFile, 'utf8'),
)

test.use({ storageState: ACCOUNT.authFile })

async function openDocuments(page: Page): Promise<Locator> {
  const documentId = manifest['blur-default']
  if (documentId === undefined) throw new Error('No document to open.')
  await page.goto(`/documents/${documentId}`)
  const list = page.getByRole('list', { name: 'Open images' })
  await expect(list.getByRole('link').nth(2)).toBeVisible()
  // The picture is drawn by the page itself, so the page can respond to keys and drags.
  await expect(page.locator('[data-slot="canvas"] img')).toBeVisible()
  return list
}

async function firstNames(list: Locator, count: number): Promise<string[]> {
  const names: string[] = []
  for (let index = 0; index < count; index += 1) {
    names.push((await list.getByRole('link').nth(index).textContent()) ?? '')
  }
  return names
}

/** The list shows the new order at once; the move is saved when the server has answered. */
function saved(page: Page): Promise<unknown> {
  return page.waitForResponse(
    (response) => response.request().method() === 'POST',
  )
}

test.describe('the documents list order', () => {
  // Tabs of one account now follow each other, so these two must not reorder the same list at once.
  test.describe.configure({ mode: 'serial' })

  test('is changed by dragging, and kept after a reload', async ({ page }) => {
    const list = await openDocuments(page)
    const [first, second, third] = await firstNames(list, 3)

    const move = saved(page)
    await list
      .getByRole('link', { name: third, exact: true })
      .locator('xpath=ancestor::li[1]')
      .dragTo(
        list
          .getByRole('link', { name: first, exact: true })
          .locator('xpath=ancestor::li[1]'),
      )

    await expect.poll(() => firstNames(list, 3)).toEqual([third, first, second])
    await move
    await page.reload()
    await expect(list.getByRole('link').nth(2)).toBeVisible()
    expect(await firstNames(list, 3)).toEqual([third, first, second])
  })

  test('is changed from the keyboard with Alt and the arrow keys', async ({
    page,
  }) => {
    const list = await openDocuments(page)
    const [first, second, third] = await firstNames(list, 3)

    await list.getByRole('link', { name: second, exact: true }).focus()
    const move = saved(page)
    await page.keyboard.press('Alt+ArrowUp')

    await expect.poll(() => firstNames(list, 3)).toEqual([second, first, third])
    await move
    await page.reload()
    await expect(list.getByRole('link').nth(2)).toBeVisible()
    expect(await firstNames(list, 3)).toEqual([second, first, third])
  })
})
