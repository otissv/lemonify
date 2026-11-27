import { expect } from '@playwright/test'
import type { Locator, Page, TestInfo } from '@playwright/test'

/**
 * The parts of the workflow page the specs use, found the way a person finds
 * them: by role and name.
 */

export function diagram(page: Page): Locator {
  return page.getByRole('application', { name: 'Workflow canvas' })
}

/** The floating panel over the diagram, with its menu and the Tools and Options tabs. */
export function floatingPanel(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Tools' })
}

export function options(page: Page): Locator {
  return page.getByRole('tabpanel', { name: 'Options' })
}

export function sidePanel(page: Page): Locator {
  return page.getByRole('region', { name: 'Side panel' })
}

/** Enough large arrow-key moves to carry the panel across any window; it stops at the edges. */
const PANEL_MOVES = 40

/**
 * Collapses the Tools panel and moves it to the bottom-left corner with its
 * keyboard handle, as a person does to reach a node the panel covers. The
 * diagram is fitted once when the page opens, so a step added later can lie
 * under the panel.
 */
export async function moveToolsAside(page: Page): Promise<void> {
  const panel = floatingPanel(page)
  await panel.getByRole('button', { name: 'Collapse panel' }).click()
  await panel.getByRole('button', { name: 'Move panel' }).focus()
  for (let move = 0; move < PANEL_MOVES; move += 1) {
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowDown')
  }
}

/** One node of the diagram: a step, or Canvas, Input images or Output. */
export function node(page: Page, label: string): Locator {
  return diagram(page)
    .getByRole('group')
    .filter({ has: page.getByText(label, { exact: true }) })
}

/** A name no other test of the account has used, since workflow names are unique. */
export function uniqueName(testInfo: TestInfo, base: string): string {
  return `${base} ${testInfo.testId}-${testInfo.repeatEachIndex}-${testInfo.retry}`
}

/** Creates a workflow from the home page and opens it. */
export async function newWorkflow(page: Page, name: string): Promise<void> {
  await page.goto('/')
  // The page answers clicks once React has hydrated it.
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'New workflow…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add workflow' })
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await page.waitForURL(/\/workflows\//)
  await expect(diagram(page)).toBeVisible()
}

/**
 * Selects a node of the diagram, which shows its options. React Flow keeps
 * its nodes moving while it fits the view, so the click is dispatched.
 */
export async function selectNode(page: Page, label: string): Promise<void> {
  await diagram(page)
    .getByText(label, { exact: true })
    .first()
    .dispatchEvent('click')
  await expect(
    options(page).getByRole('heading', { level: 2, name: label }),
  ).toBeVisible()
}

/** Adds a tool from the Tools tab, opening its category when it is closed. */
export async function addTool(
  page: Page,
  category: string,
  tool: string,
): Promise<void> {
  await floatingPanel(page).getByRole('tab', { name: 'Tools' }).click()
  const tools = page.getByRole('tabpanel', { name: 'Tools' })
  // Layers is always open; the other categories open and close.
  const heading = tools.getByRole('button', { name: category, exact: true })
  if (
    (await heading.count()) > 0 &&
    (await heading.getAttribute('aria-expanded')) !== 'true'
  ) {
    await heading.click()
  }
  await tools.getByRole('button', { name: `Add ${tool}`, exact: true }).click()
  await expect(
    options(page).getByRole('heading', { level: 2, name: tool }),
  ).toBeVisible()
}

/** Adds images the account already has as the workflow's input images. */
export async function addInputs(
  page: Page,
  fileNames: ReadonlyArray<string>,
): Promise<void> {
  await selectNode(page, 'Input images')
  for (const fileName of fileNames) {
    await options(page)
      .getByRole('button', { name: `Add ${fileName}`, exact: true })
      .click()
  }
  await expect(node(page, 'Input images')).toContainText(
    fileNames.length === 1 ? '1 image' : `${fileNames.length} images`,
  )
}

/** Types a number into a field and leaves it, which commits the change. */
export async function setNumber(
  scope: Locator,
  label: string,
  value: number,
): Promise<void> {
  const field = scope.getByRole('spinbutton', { name: label, exact: true })
  await field.fill(String(value))
  await field.press('Tab')
}

/** Picks an option of a select by the select's name. */
export async function choose(
  page: Page,
  scope: Locator,
  label: string,
  option: string,
): Promise<void> {
  await scope.getByRole('combobox', { name: label }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

/** Opens a menu of the menu bar and chooses an item. */
export async function menu(
  page: Page,
  title: string,
  item: string,
): Promise<void> {
  await floatingPanel(page)
    .getByRole('menuitem', { name: title, exact: true })
    .click()
  await page
    .getByRole('menu', { name: title })
    .getByRole('menuitem', { name: item, exact: true })
    .or(
      page
        .getByRole('menu', { name: title })
        .getByRole('menuitemcheckbox', { name: item, exact: true }),
    )
    .click()
}

/** The labels of the diagram's nodes, in the order the pipeline runs them. */
export async function nodeLabels(page: Page): Promise<string[]> {
  const labels: string[] = []
  for (const text of await diagram(page).getByRole('group').allInnerTexts()) {
    const label = text.split('\n').find((line) => line.trim() !== '')
    if (label !== undefined) labels.push(label.trim())
  }
  return labels
}
