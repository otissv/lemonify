import { configDefaults, defineConfig } from 'vitest/config'
import viteReact from '@vitejs/plugin-react'

/**
 * Tests that start processes of their own (workers, CLI commands, a web
 * server's pool) are named `*.process.test.ts`. They run after the rest, so
 * the processes they start do not take the CPU from tests with short timeouts.
 */
const PROCESS_TESTS = [
  'src/**/*.process.test.ts',
  'scripts/**/*.process.test.ts',
]

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [viteReact()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    globalSetup: ['./src/test/global-setup.ts'],
    /** No test may use the database in .env; each makes its own (src/server/testing/test-database.ts). */
    env: { POSTGRES_DATABASE: 'lemonify_test_none' },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...PROCESS_TESTS],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'processes',
          include: PROCESS_TESTS,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
})
