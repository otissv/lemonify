import { defineConfig, devices } from '@playwright/test'

const PORT = 3200
const ORIGIN = `http://localhost:${PORT}`

export const E2E_ORIGIN = ORIGIN
export const E2E_DATA_DIR = 'e2e/.data'

/**
 * End-to-end tests run against a development server of their own with an empty
 * data directory, so they never touch the data of the person running them.
 * Global setup signs an account up and fills the server with one document per
 * test case; the specs then open those documents and compare what the editor
 * shows with the snapshots in `e2e/snapshots`.
 */
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.run/results',
  snapshotPathTemplate: '{testDir}/snapshots/{arg}{ext}',
  fullyParallel: true,
  workers: 4,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  expect: {
    toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.002 },
  },
  use: {
    baseURL: ORIGIN,
    storageState: 'e2e/.run/auth.json',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `sh -c "rm -rf ${E2E_DATA_DIR} && exec pnpm exec vite dev --port ${PORT} --strictPort"`,
    url: `${ORIGIN}/sign-in`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      LEMONIFY_DATA_DIR: E2E_DATA_DIR,
      LEMONIFY_BASE_URL: ORIGIN,
      LEMONIFY_RATE_LIMIT_MULTIPLIER: '100',
      LEMONIFY_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0123456789',
    },
  },
})
