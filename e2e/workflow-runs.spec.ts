import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { expect, test } from '@playwright/test'
import sharp from 'sharp'

import { RUN_DIR, SCRATCH_ACCOUNTS } from './global-setup.ts'

const ACCOUNT = SCRATCH_ACCOUNTS.runs
const RUN_TIMEOUT = 60_000

test.use({ storageState: ACCOUNT.authFile })
test.setTimeout(120_000)

async function avifFile(): Promise<string> {
  const directory = path.join(RUN_DIR, 'workflow-runs')
  mkdirSync(directory, { recursive: true })
  const file = path.join(directory, 'photo.avif')
  await sharp({
    create: { width: 64, height: 48, channels: 3, background: '#3366cc' },
  })
    .avif()
    .toFile(file)
  return file
}

test('runs a workflow on chosen input images and downloads the results', async ({
  page,
}) => {
  await page.goto('/')
  // The page answers clicks once React has hydrated it.
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'New workflow…' }).click()
  await page.getByRole('button', { name: 'Create' }).click()
  await page.waitForURL(/\/workflows\//)

  // React Flow keeps its nodes moving while it fits the view, so the click is dispatched.
  await page
    .getByRole('application', { name: 'Workflow canvas' })
    .getByText('Input images', { exact: true })
    .dispatchEvent('click')
  const options = page.getByRole('tabpanel', { name: 'Options' })
  const chooser = page.waitForEvent('filechooser')
  await options.getByRole('button', { name: 'Upload images…' }).click()
  await (await chooser).setFiles(await avifFile())
  await options.getByRole('button', { name: 'Add scene.png' }).click()

  await page
    .getByRole('dialog', { name: 'Tools' })
    .getByRole('tab', { name: 'Tools' })
    .click()
  const tools = page.getByRole('tabpanel', { name: 'Tools' })
  await tools.getByRole('button', { name: 'Filters' }).click()
  await tools.getByRole('button', { name: /^Add Threshold/ }).click()

  const side = page.getByRole('region', { name: 'Side panel' })
  await side.getByRole('tab', { name: 'Runs' }).click()
  const picker = side.getByRole('region', { name: 'New run' })
  await expect(picker.getByText('2 of 2 chosen')).toBeVisible()
  await picker.getByRole('button', { name: 'Run on 2 images' }).click()

  const run = side.getByRole('region', { name: 'Run 1' })
  await expect(run.getByText('2 done', { exact: true })).toBeVisible({
    timeout: RUN_TIMEOUT,
  })
  await expect(run.getByRole('alert')).toHaveCount(0)

  const zipHref = await run
    .getByRole('link', { name: 'Download all' })
    .getAttribute('href')
  const zip = await page.request.get(zipHref ?? '')
  expect(zip.status()).toBe(200)
  expect(zip.headers()['content-type']).toBe('application/zip')

  const avifHref = await run
    .getByRole('link', { name: 'Download photo.avif' })
    .getAttribute('href')
  const avif = await page.request.get(avifHref ?? '')
  expect(avif.status()).toBe(200)
  expect(await sharp(await avif.body()).metadata()).toMatchObject({
    format: 'heif',
    compression: 'av1',
  })
})
