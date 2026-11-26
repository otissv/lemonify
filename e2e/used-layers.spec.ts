import path from 'node:path'

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { z } from 'zod'

import { E2E_DATA_DIR } from '../playwright.config.ts'
import { WorkflowResult, cliFailure, cliResult } from './cli.ts'
import { SCRATCH_ACCOUNTS } from './global-setup.ts'
import { menu, uniqueName } from './workflow-page.ts'

const ACCOUNT = SCRATCH_ACCOUNTS.usedLayers
const DATA = path.resolve(E2E_DATA_DIR)
const USER = ['--user', ACCOUNT.user.name]

const StepSchema = z.looseObject({ id: z.string(), kind: z.string() })
const DocumentResult = z.object({
  document: z.object({
    id: z.string(),
    name: z.string(),
    pipeline: z.object({ steps: z.array(StepSchema) }),
  }),
})

test.use({ storageState: ACCOUNT.authFile })

/** A blank document of the account's own, to hold layers or be used by one. */
async function blankDocument(name: string): Promise<string> {
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
      name,
      ...USER,
    ],
    DocumentResult,
  )
  return document.id
}

async function openSteps(page: Page, documentId: string, name: string) {
  await page.goto(`/documents/${documentId}`)
  await expect(page.locator('[data-slot="canvas"] img')).toBeVisible()
  await page.getByRole('button', { name: `Show steps of ${name}` }).click()
  return page.getByRole('list', { name: `Steps of ${name}`, exact: true })
}

test('adds a document layer from the Edit menu, opens what it uses, and converts it to an embedded copy', async ({
  page,
}, testInfo) => {
  const badgeName = uniqueName(testInfo, 'Badge')
  const badgeId = await blankDocument(badgeName)
  const holderName = uniqueName(testInfo, 'Poster')
  const steps = await openSteps(
    page,
    await blankDocument(holderName),
    holderName,
  )

  await menu(page, 'Edit', 'Add document layer…')
  const dialog = page.getByRole('dialog', { name: 'Add document layer' })
  await dialog.getByLabel('Document').selectOption({ label: badgeName })
  await dialog.getByRole('button', { name: 'Add' }).click()

  const row = steps.getByRole('button', { name: 'Document layer', exact: true })
  await expect(row).toBeVisible()
  await expect(steps.getByText(badgeName)).toBeVisible()

  await steps
    .getByRole('button', { name: 'More actions for Document layer' })
    .click()
  await page
    .getByRole('menuitem', { name: 'Convert to embedded document layer' })
    .click()
  await expect(
    steps.getByRole('button', { name: /^Embedded document layer/ }),
  ).toBeVisible()
  await expect(row).toBeHidden()

  await menu(page, 'Edit', 'Undo')
  await expect(row).toBeVisible()

  await steps
    .getByRole('button', { name: 'More actions for Document layer' })
    .click()
  await page.getByRole('menuitem', { name: `Open ${badgeName}` }).click()
  await expect(page).toHaveURL(new RegExp(`/documents/${badgeId}$`))
})

test('shows a workflow layer without an image as drawing with no input', async ({
  page,
}, testInfo) => {
  const flowName = uniqueName(testInfo, 'Brand')
  const { workflow } = await cliResult(
    DATA,
    ['workflow', 'create', flowName, '--canvas-size', 'fixed', ...USER],
    WorkflowResult,
  )
  const holderName = uniqueName(testInfo, 'Poster')
  const holder = await blankDocument(holderName)
  await cliResult(
    DATA,
    [
      'document',
      'step',
      'add',
      holder,
      '--workflow-layer',
      workflow.id,
      ...USER,
    ],
    DocumentResult,
  )

  const steps = await openSteps(page, holder, holderName)

  await expect(
    steps.getByRole('button', { name: 'Workflow layer', exact: true }),
  ).toBeVisible()
  await expect(steps.getByText(`${flowName} · no input image`)).toBeVisible()
})

test('the command line adds, refuses to delete what is in use, and converts a document layer', async () => {
  const testInfo = test.info()
  const badgeName = uniqueName(testInfo, 'Badge')
  const badge = await blankDocument(badgeName)
  const holderName = uniqueName(testInfo, 'Poster')
  const holder = await blankDocument(holderName)

  const added = await cliResult(
    DATA,
    ['document', 'step', 'add', holder, '--document-layer', badge, ...USER],
    DocumentResult,
  )
  const layer = added.document.pipeline.steps.at(-1)
  expect(layer).toMatchObject({ kind: 'document-layer', documentId: badge })
  if (layer === undefined) throw new Error('No layer was added.')

  const refused = await cliFailure(DATA, ['document', 'delete', badge, ...USER])
  expect(refused.message).toContain(`the document "${holderName}"`)

  const circular = await cliFailure(DATA, [
    'document',
    'step',
    'add',
    badge,
    '--document-layer',
    holder,
    ...USER,
  ])
  expect(circular.message).toContain('cannot use the document or workflow')

  const converted = await cliResult(
    DATA,
    [
      'document',
      'step',
      'convert',
      holder,
      layer.id,
      '--to',
      'embedded-document',
      ...USER,
    ],
    DocumentResult,
  )
  expect(converted.document.pipeline.steps.at(-1)).toMatchObject({
    id: layer.id,
    kind: 'embedded-document',
  })

  await cliResult(DATA, ['document', 'delete', badge, ...USER], z.unknown())
})
