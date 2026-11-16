import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

import { MANIFEST_FILE } from './global-setup.ts'
import type { Manifest } from './seed.ts'

const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'))
const SOURCE_NAME = 'blur-default'

test('dragging a step onto another document copies it there', async ({
  page,
}) => {
  const documentId = manifest[SOURCE_NAME]
  if (documentId === undefined) throw new Error('No document to open.')
  await page.goto(`/documents/${documentId}`)
  await expect(page.locator('[data-slot="canvas"] img')).toBeVisible()

  await page
    .getByRole('button', { name: `Show steps of ${SOURCE_NAME}` })
    .click()
  const own = page.getByRole('list', {
    name: `Steps of ${SOURCE_NAME}`,
    exact: true,
  })
  const blur = own
    .getByRole('button', { name: 'Blur', exact: true })
    .locator('xpath=ancestor::li[1]')

  // The document listed just after it, so the drag does not scroll the long list.
  const next = page
    .getByRole('link', { name: SOURCE_NAME, exact: true })
    .locator('xpath=ancestor::li[1]/following-sibling::li[1]')
  const targetName = (await next.getByRole('link').textContent()) ?? ''
  expect(targetName).not.toBe('')

  await blur.dragTo(next, { sourcePosition: { x: 3, y: 3 } })

  const copied = page.getByRole('list', {
    name: `Steps of ${targetName}`,
    exact: true,
  })
  await expect(
    copied.getByRole('button', { name: 'Blur', exact: true }),
  ).toBeVisible()
  await expect(
    own.getByRole('button', { name: 'Blur', exact: true }),
  ).toBeVisible()

  // The copy shows at once and is saved a moment later, so read the saved document until it has it.
  await expect(async () => {
    await page.reload()
    await expect(page.locator('[data-slot="canvas"] img')).toBeVisible()
    await page
      .getByRole('button', { name: `Show steps of ${targetName}`, exact: true })
      .click()
    await expect(
      page
        .getByRole('list', { name: `Steps of ${targetName}`, exact: true })
        .getByRole('button', { name: 'Blur', exact: true }),
    ).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 30_000 })
})
