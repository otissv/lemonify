// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

const startBackground = vi.fn(() => Promise.resolve())

vi.mock('@tanstack/react-start/server-only', () => ({}))
vi.mock('../config/config.ts', () => ({ loadConfig: () => ({}) }))
vi.mock('../composition.ts', () => ({
  createApp: () => Promise.resolve({ auth: {}, config: {}, startBackground }),
}))

const KEY = Symbol.for('lemonify.web-runtime')

afterEach(() => {
  Reflect.deleteProperty(globalThis, KEY)
  startBackground.mockClear()
})

describe('getRuntime', () => {
  it('starts the job scheduler once, so queued jobs are worked on', async () => {
    const { getRuntime } = await import('./runtime.ts')

    await getRuntime()
    await getRuntime()

    expect(startBackground).toHaveBeenCalledTimes(1)
  })
})
