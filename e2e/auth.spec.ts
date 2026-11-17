import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { E2E_USER } from './global-setup.ts'

test.use({ storageState: { cookies: [], origins: [] } })

/** Opens the sign-in page and waits for React to take over the form, so a click is not a plain form submit. */
async function openSignIn(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await page.waitForFunction(() => {
    const form = document.querySelector('form')
    return (
      form !== null &&
      Object.keys(form).some((key) => key.startsWith('__reactProps'))
    )
  })
}

test.describe('signing in', () => {
  test('sends a visitor who is not signed in to the sign-in page', async ({
    page,
  }) => {
    await page.goto('/')

    await expect(page).toHaveURL(/\/sign-in$/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  test('offers no password reset while the server cannot send email', async ({
    page,
  }) => {
    await page.goto('/sign-in')

    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Forgot your password?' }),
    ).toHaveCount(0)
  })

  test('shows an error for a wrong password', async ({ page }) => {
    await openSignIn(page)
    await page.getByLabel('Email').fill(E2E_USER.email)
    await page.getByLabel('Password').fill('not the password')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page).toHaveURL(/\/sign-in$/)
  })

  test('signs in with the right password and lands on the app', async ({
    page,
  }) => {
    await openSignIn(page)
    await page.getByLabel('Email').fill(E2E_USER.email)
    await page.getByLabel('Password').fill(E2E_USER.password)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page).not.toHaveURL(/\/sign-in/)
  })

  test('creates an account and signs in at once when no email is needed', async ({
    page,
  }, info) => {
    await openSignIn(page)
    await page.getByRole('button', { name: 'Create an account' }).click()
    await page.getByLabel('Name').fill('New Person')
    await page
      .getByLabel('Email')
      .fill(`new-${info.workerIndex}-${Date.now()}@example.test`)
    await page
      .getByLabel('Password', { exact: true })
      .fill('a long enough password')
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page).not.toHaveURL(/\/sign-in/)
  })
})

test.describe('the link from a reset email', () => {
  test('says the link is no good when it has no token', async ({ page }) => {
    await page.goto('/reset-password')

    await expect(page.getByRole('alert')).toContainText(
      'expired or was already used',
    )
  })

  test('says the same when the server marked the link as invalid', async ({
    page,
  }) => {
    await page.goto('/reset-password?error=INVALID_TOKEN')

    await expect(page.getByRole('alert')).toContainText(
      'expired or was already used',
    )
  })

  test('shows the form when there is a token', async ({ page }) => {
    await page.goto('/reset-password?token=abc')

    await expect(page.getByLabel('New password')).toBeVisible()
  })
})
