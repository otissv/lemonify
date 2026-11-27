import path from 'node:path'

import { expect, test } from '@playwright/test'

import {
  RunResult,
  RunsResult,
  SourcesResult,
  WorkflowResult,
  cliResult,
} from './cli.ts'
import { E2E_STORE } from './database.ts'
import { SCRATCH_ACCOUNTS } from './global-setup.ts'
import {
  addTool,
  choose,
  node,
  options,
  selectNode,
  sidePanel,
} from './workflow-page.ts'
import { z } from 'zod'

/**
 * The website and the command line are two front doors to the same workflows:
 * what one does, the other sees. The command line runs as its own process on
 * the data folder the test server uses, as the account the browser is signed
 * in as.
 */
const ACCOUNT = SCRATCH_ACCOUNTS.workflowParity
const DATA = E2E_STORE
const USER = ['--user', ACCOUNT.user.name]
const RUN_TIMEOUT = 60_000

test.use({ storageState: ACCOUNT.authFile })
test.describe.configure({ mode: 'serial', timeout: 120_000 })

const ArchiveResult = z.object({ archive: z.object({ images: z.number() }) })

let workflowId = ''
let scene = ''
let mask = ''

async function shown(): Promise<z.infer<typeof WorkflowResult>['workflow']> {
  return (
    await cliResult(
      DATA,
      ['workflow', 'show', workflowId, ...USER],
      WorkflowResult,
    )
  ).workflow
}

test('a workflow made on the command line opens on the website', async ({
  page,
}) => {
  const { sources } = await cliResult(
    DATA,
    ['source', 'list', ...USER],
    SourcesResult,
  )
  const id = (fileName: string): string => {
    const found = sources.find((source) => source.fileName === fileName)
    if (found === undefined) throw new Error(`No ${fileName} for the account.`)
    return found.id
  }
  scene = id('scene.png')
  mask = id('mask.png')
  const created = await cliResult(
    DATA,
    [
      'workflow',
      'create',
      'Made on the command line',
      '--sources',
      `${scene},${mask}`,
      '--steps',
      '[{"op":"rotate","options":{"angle":90}}]',
      ...USER,
    ],
    WorkflowResult,
  )
  workflowId = created.workflow.id

  await page.goto(`/workflows/${workflowId}`)
  await expect(node(page, 'Rotate')).toBeVisible()
  await expect(node(page, 'Input images')).toContainText('2 images')
  await expect(
    page.getByRole('link', { name: 'Made on the command line' }),
  ).toBeVisible()
})

test('a change made on the website is in the workflow the command line shows, and its undo takes it back', async ({
  page,
}) => {
  await page.goto(`/workflows/${workflowId}`)
  await expect(node(page, 'Rotate')).toBeVisible()
  await addTool(page, 'Geometry', 'Resize')
  await selectNode(page, 'Output')
  await choose(page, options(page), 'Format', 'WebP')
  await expect(node(page, 'Output')).toContainText('WebP')

  await expect.poll(async () => (await shown()).output.format).toBe('webp')
  expect(
    (await shown()).pipeline.steps.map((step) => step.op ?? step.kind),
  ).toEqual(['image-layer', 'rotate', 'resize'])

  await cliResult(
    DATA,
    ['workflow', 'undo', workflowId, ...USER],
    WorkflowResult,
  )
  await cliResult(
    DATA,
    ['workflow', 'undo', workflowId, ...USER],
    WorkflowResult,
  )
  await page.reload()
  await expect(node(page, 'Rotate')).toBeVisible()
  await expect(node(page, 'Resize')).toHaveCount(0)
  await expect(node(page, 'Output')).toContainText('Same as original')
})

test('a run started on the command line is followed on the website, and the other way round', async ({
  page,
}) => {
  const queued = await cliResult(
    DATA,
    ['workflow', 'run', workflowId, ...USER],
    RunResult,
  )
  expect(queued.run.sourceIds).toEqual([scene, mask])

  await page.goto(`/workflows/${workflowId}`)
  await sidePanel(page).getByRole('tab', { name: 'Runs' }).click()
  const runs = sidePanel(page).getByRole('tabpanel', { name: 'Runs' })
  const first = runs.getByRole('region', { name: 'Run 1' })
  await expect(first.getByText('2 done', { exact: true })).toBeVisible({
    timeout: RUN_TIMEOUT,
  })

  await runs.getByRole('button', { name: 'New run' }).click()
  const picker = runs.getByRole('region', { name: 'New run' })
  await picker.getByRole('checkbox', { name: 'mask.png' }).click()
  await picker.getByRole('button', { name: 'Run on 1 image' }).click()
  await expect(
    runs
      .getByRole('region', { name: 'Run 2' })
      .getByText('1 done', { exact: true }),
  ).toBeVisible({ timeout: RUN_TIMEOUT })

  const listed = await cliResult(
    DATA,
    ['workflow', 'runs', '--workflow', workflowId, ...USER],
    RunsResult,
  )
  const [latest, earlier] = listed.runs
  expect(latest).toMatchObject({ state: 'done', sourceIds: [scene] })
  expect(earlier?.id).toBe(queued.run.id)

  const zipped = await cliResult(
    DATA,
    [
      'workflow',
      'results',
      latest?.id ?? '',
      '--zip',
      path.join(test.info().outputDir, 'website-run.zip'),
      ...USER,
    ],
    ArchiveResult,
  )
  expect(zipped.archive.images).toBe(1)
})
