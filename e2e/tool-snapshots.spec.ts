import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { CASES } from './cases/index.ts'
import { MANIFEST_FILE } from './global-setup.ts'
import type { Manifest } from './seed.ts'

const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'))

const RENDERED_PICTURE = '[data-slot="canvas"] img[src*="/renders/preview/"]'
const RENDER_TIMEOUT = 60_000
const DATA_URL_PREFIX = 'data:image/png;base64,'

/**
 * The picture exactly as the browser decoded it, at its own size. The canvas
 * scales the picture to fit the window, which would make a resize look like
 * nothing at all; this keeps every pixel and the size.
 */
async function pictureBytes(picture: Locator): Promise<Buffer> {
  const dataUrl = await picture.evaluate((image: HTMLImageElement) => {
    const surface = document.createElement('canvas')
    surface.width = image.naturalWidth
    surface.height = image.naturalHeight
    surface.getContext('2d')?.drawImage(image, 0, 0)
    return surface.toDataURL('image/png')
  })
  return Buffer.from(dataUrl.slice(DATA_URL_PREFIX.length), 'base64')
}

/**
 * Opens each case's document the way a person would, waits for the editor to
 * show the finished render, and compares the picture it shows with the
 * snapshot that was checked by eye. A render that fails shows an alert instead
 * of a picture, and a step that is not set up is reported, so both fail here
 * by name.
 */
test.describe('the picture the editor shows', () => {
  for (const { id } of CASES) {
    test(id, async ({ page }) => {
      const documentId = manifest[id]
      if (documentId === undefined) throw new Error(`No document for ${id}.`)

      await page.goto(`/documents/${documentId}`)
      const picture = page.locator(RENDERED_PICTURE)
      const alert = page.getByRole('alert')
      await expect(picture.or(alert).first()).toBeVisible({
        timeout: RENDER_TIMEOUT,
      })
      await expect(alert).toHaveCount(0)
      await expect(page.getByText('left out until it is set up')).toHaveCount(0)
      await expect
        .poll(
          () =>
            picture.evaluate(
              (image: HTMLImageElement) =>
                image.complete && image.naturalWidth > 0,
            ),
          { timeout: RENDER_TIMEOUT },
        )
        .toBe(true)

      expect(await pictureBytes(picture)).toMatchSnapshot(`${id}.png`)
    })
  }
})
