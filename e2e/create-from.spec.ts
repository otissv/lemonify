import { readFileSync } from 'node:fs'
import path from 'node:path'

import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { z } from 'zod'

import { E2E_DATA_DIR } from '../playwright.config.ts'
import { WorkflowResult, cliResult } from './cli.ts'
import { SCRATCH_ACCOUNTS } from './global-setup.ts'
import type { Manifest } from './seed.ts'
import { menu, uniqueName } from './workflow-page.ts'

const ACCOUNT = SCRATCH_ACCOUNTS.createFrom
const manifest: Manifest = JSON.parse(
  readFileSync(ACCOUNT.manifestFile, 'utf8'),
)
const SOURCE_NAME = 'blur-default'
const DATA = path.resolve(E2E_DATA_DIR)
const USER = ['--user', ACCOUNT.user.name]
const PICTURE = '[data-slot="canvas"] img'

const DocumentResult = z.object({
  document: z.object({
    id: z.string(),
    name: z.string(),
    pipeline: z.object({
      steps: z.array(z.looseObject({ id: z.string(), kind: z.string() })),
    }),
  }),
})

test.use({ storageState: ACCOUNT.authFile })

function sourceId(): string {
  const id = manifest[SOURCE_NAME]
  if (id === undefined) throw new Error('No document to open.')
  return id
}

async function openSteps(
  page: Page,
  documentId: string,
  name: string,
): Promise<Locator> {
  await page.goto(`/documents/${documentId}`)
  await expect(page.locator(PICTURE)).toBeVisible()
  await page.getByRole('button', { name: `Show steps of ${name}` }).click()
  return page.getByRole('list', { name: `Steps of ${name}`, exact: true })
}

/** A fixed-size workflow of the account's own, and a blank document holding a workflow layer that uses it with no image. */
async function workflowLayerHolder(
  flowName: string,
  holderName: string,
): Promise<{ workflowId: string; holderId: string }> {
  const { workflow } = await cliResult(
    DATA,
    ['workflow', 'create', flowName, '--canvas-size', 'fixed', ...USER],
    WorkflowResult,
  )
  const { document } = await cliResult(
    DATA,
    [
      'document',
      'create',
      '--width',
      '120',
      '--height',
      '80',
      '--name',
      holderName,
      ...USER,
    ],
    DocumentResult,
  )
  await cliResult(
    DATA,
    [
      'document',
      'step',
      'add',
      document.id,
      '--workflow-layer',
      workflow.id,
      ...USER,
    ],
    DocumentResult,
  )
  return { workflowId: workflow.id, holderId: document.id }
}

test('makes a workflow from a document, with its input image removed, and opens it', async ({
  page,
}) => {
  await openSteps(page, sourceId(), SOURCE_NAME)

  await menu(page, 'File', 'New workflow from document…')
  const dialog = page.getByRole('dialog', { name: /^New workflow from/ })
  await dialog.getByLabel('Remove only the input image').check()
  await dialog.getByRole('button', { name: 'Create' }).click()

  await expect(page).toHaveURL(/\/workflows\/[^/]+$/)
  const workflowId = new URL(page.url()).pathname.split('/').at(-1) ?? ''
  const { workflow } = await cliResult(
    DATA,
    ['workflow', 'show', workflowId, ...USER],
    WorkflowResult,
  )
  expect(workflow.name).toMatch(/^blur-default/)
  expect(workflow.canvasSize).toBe('fixed')
  expect(workflow.inputs).toHaveLength(1)
})

test('makes a document from the workflow a selected workflow layer uses', async ({
  page,
}, testInfo) => {
  const flowName = uniqueName(testInfo, 'Brand')
  const holderName = uniqueName(testInfo, 'Poster')
  const { holderId } = await workflowLayerHolder(flowName, holderName)
  const steps = await openSteps(page, holderId, holderName)

  await steps
    .getByRole('button', { name: 'Workflow layer', exact: true })
    .click()
  await menu(page, 'File', 'New document from workflow…')
  const dialog = page.getByRole('dialog', { name: /^New document from/ })
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue(
    new RegExp(`^${flowName}`),
  )
  await dialog.getByRole('button', { name: 'Create' }).click()

  await expect(page).not.toHaveURL(new RegExp(holderId))
  await expect(page).toHaveURL(/\/documents\/[^/]+$/)
})

test('inserts a copy of a workflow as an embedded document layer named after it', async ({
  page,
}, testInfo) => {
  const flowName = uniqueName(testInfo, 'Frame')
  const holderName = uniqueName(testInfo, 'Card')
  const { holderId } = await workflowLayerHolder(flowName, holderName)
  const steps = await openSteps(page, holderId, holderName)

  await menu(page, 'Edit', 'Insert workflow…')
  const dialog = page.getByRole('dialog', { name: 'Insert workflow' })
  await dialog.getByLabel('Workflow').selectOption({ label: flowName })
  await dialog.getByRole('button', { name: 'Insert' }).click()

  await expect(
    steps.getByRole('button', {
      name: `Embedded document layer ${flowName}`,
    }),
  ).toBeVisible()
})

test('the command line makes a workflow from a document and a document from that workflow', async () => {
  const testInfo = test.info()
  const name = uniqueName(testInfo, 'Round trip')
  const { workflow } = await cliResult(
    DATA,
    [
      'workflow',
      'create',
      name,
      '--from-document',
      sourceId(),
      '--images',
      'remove',
      ...USER,
    ],
    WorkflowResult,
  )
  expect(workflow.inputs).toHaveLength(1)
  expect(workflow.pipeline.steps.at(0)).toMatchObject({ kind: 'image-layer' })

  const { document } = await cliResult(
    DATA,
    ['document', 'create', '--from-workflow', workflow.id, ...USER],
    DocumentResult,
  )
  expect(document.name).toBe(name)
  expect(document.pipeline.steps.map(({ kind }) => kind)).toEqual(
    workflow.pipeline.steps.map(({ kind }) => kind),
  )
})
