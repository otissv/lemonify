import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

import { SCRATCH_ACCOUNTS } from './global-setup.ts'
import type { Manifest } from './seed.ts'

const ACCOUNT = SCRATCH_ACCOUNTS.groups
const manifest: Manifest = JSON.parse(
  readFileSync(ACCOUNT.manifestFile, 'utf8'),
)
const SOURCE_NAME = 'blur-default'

test.use({ storageState: ACCOUNT.authFile })

test('groups a step from the toolbar, folds, switches and places it, and takes it apart', async ({
  page,
}) => {
  const documentId = manifest[SOURCE_NAME]
  if (documentId === undefined) throw new Error('No document to open.')
  await page.goto(`/documents/${documentId}`)
  await expect(page.locator('[data-slot="canvas"] img')).toBeVisible()
  await page
    .getByRole('button', { name: `Show steps of ${SOURCE_NAME}` })
    .click()
  const steps = page.getByRole('list', {
    name: `Steps of ${SOURCE_NAME}`,
    exact: true,
  })
  const toolbar = page.getByRole('toolbar', { name: 'Image tools' })
  const group = toolbar.getByRole('button', { name: 'Group selected steps' })

  await expect(group).toBeDisabled()
  await steps.getByRole('button', { name: 'Blur', exact: true }).click()
  await expect(group).toBeEnabled()
  await group.click()

  const inside = steps.getByRole('list', { name: 'Steps in Group' })
  await expect(
    inside.getByRole('button', { name: 'Blur', exact: true }),
  ).toBeVisible()
  await expect(steps.getByText('1 step', { exact: true })).toBeVisible()

  await steps.getByRole('button', { name: 'Collapse Group' }).click()
  await expect(inside).toBeHidden()
  await steps.getByRole('button', { name: 'Expand Group' }).click()
  await expect(inside).toBeVisible()

  await steps.getByRole('button', { name: 'Hide Group' }).click()
  await expect(steps.getByRole('button', { name: 'Show Group' })).toBeVisible()
  await steps.getByRole('button', { name: 'Show Group' }).click()

  await steps.getByRole('button', { name: 'Group Group' }).click()
  await page.getByRole('switch', { name: 'Embedded document layer' }).click()
  await expect(
    page.getByRole('switch', { name: 'Embedded document layer' }),
  ).toBeChecked()
  await expect(page.getByRole('slider', { name: 'Opacity' })).toBeVisible()
  await page.getByRole('switch', { name: 'Embedded document layer' }).click()
  await expect(steps.getByText('1 step', { exact: true })).toBeVisible()

  // Saved: a second tab, which reads the document from the server, finds the group. This tab stays open, so its changes still get sent.
  const other = await page.context().newPage()
  await other.goto(`/documents/${documentId}`)
  const toggle = other.getByRole('button', {
    name: new RegExp(`steps of ${SOURCE_NAME}$`),
  })
  // The button is on the page before it responds, so click until it has opened the steps.
  await expect(async () => {
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click()
    }
    await expect(toggle).toHaveAttribute('aria-expanded', 'true', {
      timeout: 1000,
    })
  }).toPass({ timeout: 10_000 })
  await expect(
    other
      .getByRole('list', { name: 'Steps in Group' })
      .getByRole('button', { name: 'Blur', exact: true }),
  ).toBeVisible()
  await other.close()

  await page.getByRole('button', { name: 'Group Group' }).click()
  await page.getByRole('button', { name: 'Ungroup' }).click()
  await expect(page.getByRole('list', { name: 'Steps in Group' })).toHaveCount(
    0,
  )
  await expect(
    page
      .getByRole('list', { name: `Steps of ${SOURCE_NAME}`, exact: true })
      .getByRole('button', { name: 'Blur', exact: true }),
  ).toBeVisible()
})

test('opens the image library from the toolbar', async ({ page }) => {
  const documentId = manifest[SOURCE_NAME]
  if (documentId === undefined) throw new Error('No document to open.')
  await page.goto(`/documents/${documentId}`)

  await expect(
    page
      .getByRole('toolbar', { name: 'Image tools' })
      .getByRole('button', { name: 'Open image', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('toolbar', { name: 'Image tools' })
    .getByRole('button', { name: 'Open image library' })
    .click()

  await expect(page.getByRole('dialog')).toBeVisible()
})
