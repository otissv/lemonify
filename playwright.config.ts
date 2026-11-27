import { defineConfig, devices } from '@playwright/test'

const PORT = 3200
const REALTIME_PORT = 3201
const ORIGIN = `http://localhost:${PORT}`

export const E2E_ORIGIN = ORIGIN
export const E2E_REALTIME_URL = `ws://localhost:${REALTIME_PORT}/realtime`
export const E2E_DATA_DIR = 'e2e/.data'
/** The run's own database on the Postgres server in .env; it is emptied when the server starts. */
export const E2E_DATABASE = 'lemonify_e2e'
const RESPONSIVENESS_SPEC = /responsiveness\.spec\.ts/
const RESET_DATABASE = `node --disable-warning=ExperimentalWarning --experimental-transform-types --import ./scripts/images/register-alias.ts e2e/reset-database.ts`

/**
 * End-to-end tests run against the production build, served by a server of
 * their own with an empty data directory and database, so they check the app
 * as it ships and never touch the data of the person running them.
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
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: RESPONSIVENESS_SPEC,
    },
    /**
     * Times the server's answers, so it runs after every other spec, when no
     * other spec's renders share the server (e2e/responsiveness.spec.ts).
     */
    {
      name: 'responsiveness',
      use: { ...devices['Desktop Chrome'] },
      testMatch: RESPONSIVENESS_SPEC,
      dependencies: ['chromium'],
    },
  ],
  webServer: {
    command: `sh -c "rm -rf ${E2E_DATA_DIR} && ${RESET_DATABASE} && pnpm build && exec pnpm exec vite preview --port ${PORT} --strictPort"`,
    url: `${ORIGIN}/sign-in`,
    /** Building takes about half a minute before the server starts. */
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      LEMONIFY_DATA_DIR: E2E_DATA_DIR,
      POSTGRES_DATABASE: E2E_DATABASE,
      LEMONIFY_BASE_URL: ORIGIN,
      LEMONIFY_REALTIME_PORT: String(REALTIME_PORT),
      LEMONIFY_RATE_LIMIT_MULTIPLIER: '100',
      LEMONIFY_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0123456789',
    },
  },
})
