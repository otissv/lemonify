import { expect, test } from '@playwright/test'

import { SCRATCH_ACCOUNTS } from './global-setup.ts'
import {
  addInputs,
  addTool,
  choose,
  diagram,
  menu,
  newWorkflow,
  node,
  nodeLabels,
  options,
  selectNode,
  setNumber,
  sidePanel,
  uniqueName,
} from './workflow-page.ts'

test.use({ storageState: SCRATCH_ACCOUNTS.workflowEditing.authFile })

let workflowName = ''

test.beforeEach(async ({ page }, testInfo) => {
  workflowName = uniqueName(testInfo, 'Editing')
  await newWorkflow(page, workflowName)
})

test('adds, sets up, moves, hides and removes steps, and keeps them after a reload', async ({
  page,
}) => {
  await addTool(page, 'Geometry', 'Resize')
  await expect(node(page, 'Resize')).toContainText('Default options')
  await setNumber(options(page), 'Width', 100)
  await expect(node(page, 'Resize')).not.toContainText('Default options')

  await addTool(page, 'Geometry', 'Rotate')
  expect(await nodeLabels(page)).toEqual([
    'Canvas',
    'Input images',
    'Image layer',
    'Resize',
    'Rotate',
    'Output',
  ])

  await options(page)
    .getByRole('button', { name: 'Move Rotate earlier' })
    .click()
  await expect
    .poll(() => nodeLabels(page))
    .toEqual([
      'Canvas',
      'Input images',
      'Image layer',
      'Rotate',
      'Resize',
      'Output',
    ])

  await options(page).getByRole('button', { name: 'Hide Rotate' }).click()
  await expect(
    options(page).getByRole('button', { name: 'Show Rotate' }),
  ).toBeVisible()

  await diagram(page).getByRole('button', { name: 'Delete Resize' }).click()
  await expect(node(page, 'Resize')).toHaveCount(0)

  await page.reload()
  await expect(node(page, 'Rotate')).toBeVisible()
  await expect(node(page, 'Resize')).toHaveCount(0)
  await selectNode(page, 'Rotate')
  await expect(
    options(page).getByRole('button', { name: 'Show Rotate' }),
  ).toBeVisible()
})

test('undoes and redoes from the Edit menu and the keys', async ({ page }) => {
  await addTool(page, 'Geometry', 'Resize')

  await menu(page, 'Edit', 'Undo')
  await expect(node(page, 'Resize')).toHaveCount(0)
  await menu(page, 'Edit', 'Redo')
  await expect(node(page, 'Resize')).toBeVisible()

  await diagram(page).click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('ControlOrMeta+z')
  await expect(node(page, 'Resize')).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(node(page, 'Resize')).toBeVisible()
})

test('matches each input image by default, and keeps a size of its own once set', async ({
  page,
}) => {
  await expect(node(page, 'Canvas')).toContainText('Size of each image')
  await menu(page, 'Edit', 'Canvas size…')
  await expect(
    options(page).getByRole('heading', { level: 2, name: 'Canvas' }),
  ).toBeVisible()
  await expect(options(page).getByLabel('Width (px)')).toHaveCount(0)

  await choose(page, options(page), 'Canvas size', 'Set size')
  await options(page).getByLabel('Width (px)').fill('640')
  await options(page).getByLabel('Height (px)').fill('480')
  await options(page).getByRole('button', { name: 'Apply canvas' }).click()
  await expect(node(page, 'Canvas')).toContainText('640 × 480 px')

  await page.reload()
  await expect(node(page, 'Canvas')).toContainText('640 × 480 px')

  await selectNode(page, 'Canvas')
  await choose(page, options(page), 'Canvas size', 'Match each input image')
  await expect(node(page, 'Canvas')).toContainText('Size of each image')
  await menu(page, 'Edit', 'Undo')
  await expect(node(page, 'Canvas')).toContainText('640 × 480 px')
})

test('names its files by the Output settings', async ({ page }) => {
  await selectNode(page, 'Output')
  await choose(page, options(page), 'Format', 'WebP')
  await expect(node(page, 'Output')).toContainText('WebP')

  await options(page).getByLabel('Suffix').fill('-web')
  await options(page).getByLabel('Suffix').press('Tab')
  await expect(
    options(page).getByRole('list', { name: 'Files per image' }),
  ).toContainText('photo-web.webp')

  await page.reload()
  await expect(node(page, 'Output')).toContainText('WebP')
})

test('adds and takes out input images, which undo puts back', async ({
  page,
}) => {
  await expect(node(page, 'Input images')).toContainText('No images yet')
  await addInputs(page, ['scene.png', 'mask.png'])
  const chosen = options(page).getByRole('list', {
    name: 'Images',
    exact: true,
  })
  await expect(chosen).toContainText('scene.png')
  await expect(chosen).toContainText('mask.png')

  await chosen.getByRole('button', { name: 'Remove scene.png' }).click()
  await expect(node(page, 'Input images')).toContainText('1 image')
  await menu(page, 'Edit', 'Undo')
  await expect(node(page, 'Input images')).toContainText('2 images')
})

test('shows the picture of the selected node, and the runs, beside the diagram', async ({
  page,
}) => {
  const tabs = sidePanel(page)
  await expect(tabs.getByRole('tab', { name: 'Preview' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(tabs.getByRole('img', { name: 'Output' })).toBeVisible()

  await menu(page, 'View', 'Run panel')
  await expect(tabs.getByRole('tab', { name: 'Runs' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await menu(page, 'View', 'Run panel')
  await expect(sidePanel(page)).toHaveCount(0)

  await menu(page, 'View', 'Step preview')
  await expect(tabs.getByRole('tab', { name: 'Preview' })).toHaveAttribute(
    'aria-selected',
    'true',
  )

  await diagram(page).click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Alt+r')
  await expect(tabs.getByRole('tab', { name: 'Runs' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await selectNode(page, 'Canvas')
  await expect(tabs.getByRole('tab', { name: 'Preview' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(tabs.getByRole('img', { name: 'Canvas' })).toBeVisible()

  await diagram(page).click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Alt+p')
  await expect(sidePanel(page)).toHaveCount(0)
})

test('adds a group to the pipeline', async ({ page }) => {
  await addTool(page, 'Layers', 'Group')
  await expect(node(page, 'Group')).toBeVisible()
  await menu(page, 'Edit', 'Undo')
  await expect(node(page, 'Group')).toHaveCount(0)
})

test('zooms and moves the large picture with its toolbar', async ({ page }) => {
  const toolbar = sidePanel(page).getByRole('toolbar', { name: 'Preview view' })
  const zoom = toolbar.getByRole('textbox', { name: 'Zoom' })
  await expect(zoom).toHaveValue(/%$/)
  const fitted = await zoom.inputValue()

  await toolbar.getByRole('button', { name: 'Zoom in' }).click()
  await expect(zoom).not.toHaveValue(fitted)
  await toolbar.getByRole('button', { name: 'Actual size' }).click()
  await expect(zoom).toHaveValue('100%')
  await toolbar.getByRole('button', { name: 'Fit on screen' }).click()
  await expect(zoom).toHaveValue(fitted)
})

test('renames, shows and deletes a workflow from the sidebar', async ({
  page,
}) => {
  const workflows = page.getByRole('list', { name: 'Workflows' })
  const link = workflows.getByRole('link', { name: workflowName, exact: true })
  await link.focus()
  await page.keyboard.press('F2')
  const renamed = `${workflowName} renamed`
  const field = workflows.getByRole('textbox', { name: 'Document name' })
  await field.fill(renamed)
  await field.press('Enter')
  await expect(
    workflows.getByRole('link', { name: renamed, exact: true }),
  ).toBeVisible()

  await page.reload()
  await expect(
    workflows.getByRole('link', { name: renamed, exact: true }),
  ).toBeVisible()
  const preview = workflows.getByRole('button', {
    name: `Show preview of ${renamed}`,
  })
  await preview.click()
  await expect(
    workflows.getByRole('button', { name: `Hide preview of ${renamed}` }),
  ).toHaveAttribute('aria-expanded', 'true')

  await workflows.getByRole('button', { name: `Delete ${renamed}` }).click()
  await page.waitForURL((url) => url.pathname === '/')
  await expect(
    workflows.getByRole('link', { name: renamed, exact: true }),
  ).toHaveCount(0)
})
