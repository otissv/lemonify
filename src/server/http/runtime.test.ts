// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const startBackground = vi.fn(() => Promise.resolve())
const startRealtimeServer = vi.fn()
const startChannelServer = vi.fn()
const createApp = vi.fn()
const hub = { name: 'hub', publish: vi.fn() }

vi.mock('@tanstack/react-start/server-only', () => ({}))
vi.mock('../config/config.ts', () => ({
  loadConfig: () => ({}),
  channelSocketPath: () => '/data/run/lemonify.sock',
}))
vi.mock('../channel/channel-server.ts', () => ({ startChannelServer }))
vi.mock('../composition.ts', () => ({
  AppRole: { WebServer: 'web-server', Process: 'process' },
  createApp: (...args: unknown[]) => {
    createApp(...args)
    return Promise.resolve({
      auth: { name: 'auth' },
      config: {
        rateLimitMultiplier: 1,
        trustedOrigins: ['http://localhost:3100'],
        realtime: { host: '127.0.0.1', port: 3101 },
      },
      realtime: hub,
      startBackground,
    })
  },
}))
vi.mock('../realtime/realtime-server.ts', () => ({ startRealtimeServer }))

const KEY = Symbol.for('lemonify.web-runtime')

beforeEach(() => {
  startRealtimeServer.mockResolvedValue({ port: 3101, close: vi.fn() })
  startChannelServer.mockResolvedValue({ close: vi.fn() })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, KEY)
  startBackground.mockClear()
  startRealtimeServer.mockReset()
  startChannelServer.mockReset()
  createApp.mockClear()
  hub.publish.mockClear()
})

describe('getRuntime', () => {
  it('starts the background work (the worker pool and the cleanup) once', async () => {
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

  it('composes the app as the web server, whose services tell its own tabs', async () => {
    const { getRuntime } = await import('./runtime.ts')

    await getRuntime()

    expect(createApp).toHaveBeenCalledWith(expect.anything(), {
      role: 'web-server',
    })
  })

  it('listens once on the data folder’s socket and passes the other processes’ changes to the open tabs', async () => {
    const { getRuntime } = await import('./runtime.ts')

    await getRuntime()
    await getRuntime()

    expect(startChannelServer).toHaveBeenCalledTimes(1)
    const [deps] = startChannelServer.mock.calls[0] ?? []
    expect(deps).toMatchObject({ socketPath: '/data/run/lemonify.sock' })
    deps.onChange('ann', { type: 'results.changed' })
    expect(hub.publish).toHaveBeenCalledWith('ann', { type: 'results.changed' })
  })

  it('stops with a message that names the variable when the port is taken', async () => {
    startRealtimeServer.mockRejectedValue(new Error('listen EADDRINUSE'))
    const { getRuntime } = await import('./runtime.ts')

    await expect(getRuntime()).rejects.toThrow(
      /127\.0\.0\.1:3101.*LEMONIFY_REALTIME_PORT.*EADDRINUSE/,
    )
  })
})
