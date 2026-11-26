import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import { E2E_DATA_DIR } from '../playwright.config.ts'
import { WorkflowResult, cliResult } from './cli.ts'
import { SCRATCH_ACCOUNTS } from './global-setup.ts'
import type { Manifest } from './seed.ts'
import { diagram, node, uniqueName } from './workflow-page.ts'

const ACCOUNT = SCRATCH_ACCOUNTS.nesting
const manifest: Manifest = JSON.parse(
  readFileSync(ACCOUNT.manifestFile, 'utf8'),
)
const SOURCE_NAME = 'blur-default'
const DATA = path.resolve(E2E_DATA_DIR)

test.use({ storageState: ACCOUNT.authFile })

test('nests a group inside an embedded document layer from the sidebar, and shows it as a tree', async ({
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
  const group = page
    .getByRole('toolbar', { name: 'Image tools' })
    .getByRole('button', { name: 'Group selected steps' })

  await steps.getByRole('button', { name: 'Blur', exact: true }).click()
  await group.click()
  await steps.getByRole('button', { name: 'Group Group' }).click()
  await page.getByRole('switch', { name: 'Embedded document layer' }).click()
  await expect(
    steps.getByRole('button', { name: /^Embedded document layer / }),
  ).toBeVisible()

  await steps.getByRole('button', { name: 'Blur', exact: true }).click()
  await group.click()

  const embedded = steps.getByRole('list', { name: /^Steps in Embedded/ })
  const inner = embedded.getByRole('list', { name: 'Steps in Group' })
  await expect(
    inner.getByRole('button', { name: 'Blur', exact: true }),
  ).toBeVisible()
  await expect(page.locator('[data-slot="canvas"] img')).toBeVisible()
})

test('shows a workflow’s embedded document layer and the group in it as frames around their steps', async ({
  page,
}, testInfo) => {
  const blur = {
    id: randomUUID(),
    kind: 'sharp',
    op: 'blur',
    options: { sigma: 2 },
    enabled: true,
  }
  const pipeline = {
    canvas: { width: 320, height: 240, background: 'transparent' },
    steps: [
      { id: randomUUID(), kind: 'image-layer', enabled: true },
      {
        id: randomUUID(),
        kind: 'embedded-document',
        enabled: true,
        name: 'Badge',
        steps: [
          {
            id: randomUUID(),
            kind: 'group',
            enabled: true,
            name: 'Soften',
            steps: [blur],
          },
        ],
      },
    ],
  }
  const { workflow } = await cliResult(
    DATA,
    [
      'workflow',
      'create',
      uniqueName(testInfo, 'Nested'),
      '--pipeline',
      JSON.stringify(pipeline),
      '--user',
      ACCOUNT.user.name,
    ],
    WorkflowResult,
  )

  await page.goto(`/workflows/${workflow.id}`)
  await expect(diagram(page)).toBeVisible()
  await expect(node(page, 'Badge').first()).toBeVisible()
  await expect(node(page, 'Soften').first()).toBeVisible()
  await expect(node(page, 'Blur').first()).toBeVisible()
})
