import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import sharp from 'sharp'

import { RUN_DIR, SCRATCH_ACCOUNTS } from './global-setup.ts'
import {
  addInputs,
  addTool,
  newWorkflow,
  node,
  options,
  setNumber,
  sidePanel,
  uniqueName,
} from './workflow-page.ts'

const RUN_TIMEOUT = 60_000
/** A new run shows once the runs list reloads, which waits behind the CLI's writes to the same database. */
const START_TIMEOUT = 15_000

test.use({ storageState: SCRATCH_ACCOUNTS.workflowRuns.authFile })
test.describe.configure({ timeout: 120_000 })

async function runsTab(page: Page): Promise<Locator> {
  await sidePanel(page).getByRole('tab', { name: 'Runs' }).click()
  return sidePanel(page).getByRole('tabpanel', { name: 'Runs' })
}

async function moreActions(
  page: Page,
  run: Locator,
  name: string,
  item: string,
): Promise<void> {
  await run.getByRole('button', { name: `More actions for ${name}` }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

test('chooses the images a run goes over: search, select all and a Shift range', async ({
  page,
}, testInfo) => {
  await newWorkflow(page, uniqueName(testInfo, 'Picker'))
  await addInputs(page, ['scene.png', 'mask.png', 'overlay.png', 'cutout.png'])
  const runs = await runsTab(page)
  const picker = runs.getByRole('region', { name: 'New run' })
  await expect(picker.getByText('4 of 4 chosen')).toBeVisible()

  const search = picker.getByRole('searchbox', { name: 'Search images' })
  await search.fill('mask')
  await expect(picker.getByRole('checkbox', { name: 'scene.png' })).toHaveCount(
    0,
  )
  await picker.getByRole('checkbox', { name: 'Select all' }).click()
  await expect(picker.getByText('3 of 4 chosen')).toBeVisible()
  await search.fill('')

  await picker.getByRole('checkbox', { name: 'Select all' }).click()
  await expect(picker.getByText('4 of 4 chosen')).toBeVisible()
  await picker.getByRole('checkbox', { name: 'Select all' }).click()
  await expect(picker.getByText('0 of 4 chosen')).toBeVisible()
  await expect(picker.getByText('Choose at least one image.')).toBeVisible()
  await expect(
    picker.getByRole('button', { name: 'Run on 0 images' }),
  ).toBeDisabled()

  await picker.getByRole('checkbox', { name: 'scene.png' }).click()
  await picker
    .getByRole('checkbox', { name: 'overlay.png' })
    .click({ modifiers: ['Shift'] })
  await expect(picker.getByText('3 of 4 chosen')).toBeVisible()
  await expect(
    picker.getByRole('checkbox', { name: 'cutout.png' }),
  ).not.toBeChecked()

  await picker.getByRole('button', { name: 'Run on 3 images' }).click()
  const run = runs.getByRole('region', { name: 'Run 1' })
  await expect(run.getByText(/^3 images · started/)).toBeVisible({
    timeout: START_TIMEOUT,
  })
  await expect(run.getByText('3 done', { exact: true })).toBeVisible({
    timeout: RUN_TIMEOUT,
  })
  const images = run.getByRole('list', { name: 'Images' })
  await expect(images).not.toContainText('cutout.png')
})

test('says which images failed and why, retries them, runs again and deletes a run', async ({
  page,
}, testInfo) => {
  await newWorkflow(page, uniqueName(testInfo, 'Retry'))
  await addInputs(page, ['scene.png', 'overlay.png'])
  // overlay.png is 160 × 120, too small for this area; scene.png is 320 × 240.
  await addTool(page, 'Geometry', 'Extract')
  await setNumber(options(page), 'Left', 0)
  await setNumber(options(page), 'Top', 0)
  await setNumber(options(page), 'Width', 200)
  await setNumber(options(page), 'Height', 150)

  const runs = await runsTab(page)
  await runs.getByRole('button', { name: 'Run on 2 images' }).click()
  const first = runs.getByRole('region', { name: 'Run 1' })
  await expect(
    first.getByText('1 done, 1 failed', { exact: true }),
  ).toBeVisible({
    timeout: RUN_TIMEOUT,
  })
  await expect(first.getByRole('alert')).toContainText('bad extract area')
  const images = first.getByRole('list', { name: 'Images' })
  await expect(
    images.getByRole('listitem').filter({ hasText: 'overlay.png' }),
  ).toContainText('Failed')
  await expect(
    images.getByRole('link', { name: 'Download scene.png' }),
  ).toBeVisible()
  await expect(
    images.getByRole('link', { name: 'Download overlay.png' }),
  ).toHaveCount(0)

  await moreActions(page, first, 'Run 1', 'Retry failed')
  const retry = runs.getByRole('region', { name: 'Run 2' })
  await expect(retry.getByText(/^1 image · started/)).toBeVisible({
    timeout: START_TIMEOUT,
  })
  await expect(
    retry.getByText('0 done, 1 failed', { exact: true }),
  ).toBeVisible({
    timeout: RUN_TIMEOUT,
  })

  const list = runs.getByRole('list', { name: 'Runs' })
  await list.getByRole('button', { name: /^Run 1/ }).click()
  await moreActions(
    page,
    runs.getByRole('region', { name: 'Run 1' }),
    'Run 1',
    'Run again',
  )
  const again = runs.getByRole('region', { name: 'Run 3' })
  await expect(again.getByText(/^2 images · started/)).toBeVisible({
    timeout: START_TIMEOUT,
  })
  await expect(
    again.getByText('1 done, 1 failed', { exact: true }),
  ).toBeVisible({
    timeout: RUN_TIMEOUT,
  })

  await moreActions(page, again, 'Run 3', 'Delete run')
  await expect(list.getByRole('button', { name: /^Run \d/ })).toHaveCount(2)
})

/** Pictures of different colours, so each is an image of its own and not the same one uploaded twice. */
async function distinctPictures(count: number): Promise<string[]> {
  const folder = path.join(RUN_DIR, 'workflow-run-actions')
  mkdirSync(folder, { recursive: true })
  const files: string[] = []
  for (let index = 0; index < count; index += 1) {
    const file = path.join(folder, `extra-${index}.png`)
    const shade = 40 + index * 30
    await sharp({
      create: {
        width: 64,
        height: 48,
        channels: 3,
        background: { r: shade, g: 90, b: 160 },
      },
    })
      .png()
      .toFile(file)
    files.push(file)
  }
  return files
}

test('stops a run part of the way', async ({ page }, testInfo) => {
  await newWorkflow(page, uniqueName(testInfo, 'Stop'))
  // More images than the server works on at once, so some are still waiting
  // when Stop is pressed, and those are never drawn.
  await addInputs(page, ['scene.png', 'mask.png', 'overlay.png', 'cutout.png'])
  const chooser = page.waitForEvent('filechooser')
  await options(page).getByRole('button', { name: 'Upload images…' }).click()
  await (await chooser).setFiles(await distinctPictures(4))
  await expect(node(page, 'Input images')).toContainText('8 images')
  await addTool(page, 'Geometry', 'Resize')
  await setNumber(options(page), 'Width', 9000)

  const runs = await runsTab(page)
  await runs.getByRole('button', { name: 'Run on 8 images' }).click()
  const run = runs.getByRole('region', { name: 'Run 1' })
  await run.getByRole('button', { name: 'Stop' }).click()

  await expect(run.getByText(/^Stopped at \d of 8$/)).toBeVisible({
    timeout: RUN_TIMEOUT,
  })
  await expect(run.getByRole('button', { name: 'Stop' })).toHaveCount(0)
  await expect(
    run.getByRole('list', { name: 'Images' }).getByText('Stopped').first(),
  ).toBeVisible()
})
