// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const startBackground = vi.fn(() => Promise.resolve())
const startRealtimeServer = vi.fn()
const hub = { name: 'hub' }

vi.mock('@tanstack/react-start/server-only', () => ({}))
vi.mock('../config/config.ts', () => ({ loadConfig: () => ({}) }))
vi.mock('../composition.ts', () => ({
  createApp: () =>
    Promise.resolve({
      auth: { name: 'auth' },
      config: {
        rateLimitMultiplier: 1,
        trustedOrigins: ['http://localhost:3100'],
        realtime: { host: '127.0.0.1', port: 3101 },
      },
      realtime: hub,
      startBackground,
    }),
}))
vi.mock('../realtime/realtime-server.ts', () => ({ startRealtimeServer }))

const KEY = Symbol.for('lemonify.web-runtime')

beforeEach(() => {
  startRealtimeServer.mockResolvedValue({ port: 3101, close: vi.fn() })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, KEY)
  startBackground.mockClear()
  startRealtimeServer.mockReset()
})

describe('getRuntime', () => {
  it('starts the job scheduler once, so queued jobs are worked on', async () => {
    const { getRuntime } = await import('./runtime.ts')

    await getRuntime()
    await getRuntime()

    expect(startBackground).toHaveBeenCalledTimes(1)
  })

  it('starts the realtime server once, for the site’s own origins, on the configured address', async () => {
    const { getRuntime } = await import('./runtime.ts')

    await getRuntime()
    await getRuntime()

    expect(startRealtimeServer).toHaveBeenCalledTimes(1)
    expect(startRealtimeServer).toHaveBeenCalledWith(
      expect.objectContaining({
        hub,
        auth: { name: 'auth' },
        trustedOrigins: ['http://localhost:3100'],
        host: '127.0.0.1',
        port: 3101,
      }),
    )
  })

  it('stops with a message that names the variable when the port is taken', async () => {
    startRealtimeServer.mockRejectedValue(new Error('listen EADDRINUSE'))
    const { getRuntime } = await import('./runtime.ts')

    await expect(getRuntime()).rejects.toThrow(
      /127\.0\.0\.1:3101.*LEMONIFY_REALTIME_PORT.*EADDRINUSE/,
    )
  })
})
