import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { MANIFEST_FILE } from './global-setup.ts'
import type { Manifest } from './seed.ts'

const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'))
const RENDER_TIMEOUT = 60_000

async function openDocument(page: Page): Promise<void> {
  const documentId = manifest['blur-default']
  if (documentId === undefined) throw new Error('No document to open.')
  await page.goto(`/documents/${documentId}`)
  await expect(
    page.locator('[data-slot="canvas"] img[src*="/renders/preview/"]'),
  ).toBeVisible({ timeout: RENDER_TIMEOUT })
  await page.getByRole('tab', { name: 'Navigator' }).click()
  await expect(zoomField(page)).toHaveValue(/%$/)
}

function zoomField(page: Page): Locator {
  return page
    .locator('[data-slot="navigator"]')
    .getByRole('textbox', { name: 'Zoom' })
}

function percentOf(field: Locator): Promise<number> {
  return field.inputValue().then((text) => Number.parseFloat(text))
}

test.describe('zoom and pan', () => {
  test('the canvas and the Navigator share one view', async ({ page }) => {
    await openDocument(page)
    const canvasWindow = page.getByRole('application', { name: 'Canvas' })
    const zoom = zoomField(page)
    const fitPercent = await percentOf(zoom)

    const navigator = page.locator('[data-slot="navigator"]')

    const box = await canvasWindow.boundingBox()
    if (!box) throw new Error('The canvas has no size.')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -300)
    await page.keyboard.up('Control')

    await expect.poll(() => percentOf(zoom)).toBeGreaterThan(fitPercent)

    const frame = navigator.locator('[data-slot="navigator-view"]')
    const before = await frame.boundingBox()
    const preview = await navigator
      .locator('[data-slot="navigator-preview"]')
      .boundingBox()
    if (!before || !preview) throw new Error('The Navigator has no size.')
    expect(before.width).toBeLessThan(preview.width)

    await page.mouse.move(before.x + before.width / 2, before.y + 2)
    await page.mouse.down()
    await page.mouse.move(before.x + before.width / 2 - 30, before.y - 30)
    await page.mouse.up()
    const after = await frame.boundingBox()
    expect(after?.x).toBeLessThan(before.x)
  })

  test('typing a percentage and the keys move the view', async ({ page }) => {
    await openDocument(page)
    const canvasWindow = page.getByRole('application', { name: 'Canvas' })
    const zoom = zoomField(page)

    const fitPercent = await percentOf(zoom)

    await zoom.fill(`${fitPercent * 2}`)
    await zoom.press('Enter')
    await expect(zoom).toHaveValue(`${fitPercent * 2}%`)

    await canvasWindow.focus()
    await page.keyboard.press('+')
    await expect.poll(() => percentOf(zoom)).toBeGreaterThan(fitPercent * 2)

    await page.keyboard.press('0')
    await expect(zoom).toHaveValue(`${fitPercent}%`)

    await canvasWindow.dblclick()
    await expect(zoom).toHaveValue('100%')
    await canvasWindow.dblclick()
    await expect(zoom).toHaveValue(`${fitPercent}%`)

    await zoom.fill('20')
    await zoom.press('Enter')
    await expect(zoom).toHaveValue('20%')
  })

  test('dragging moves the picture once it is zoomed in', async ({ page }) => {
    await openDocument(page)
    const canvasWindow = page.getByRole('application', { name: 'Canvas' })
    const picture = page.locator('[data-slot="canvas"]')
    await canvasWindow.focus()
    await page.keyboard.press('+')
    await page.keyboard.press('+')
    await page.keyboard.press('+')
    const before = await picture.boundingBox()
    const box = await canvasWindow.boundingBox()
    if (!before || !box) throw new Error('The canvas has no size.')

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2)
    await page.mouse.up()

    const after = await picture.boundingBox()
    expect(after?.x).toBeGreaterThan(before.x + 40)
  })
})
