import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { ValidationError } from '../errors'
import {
  databaseFile,
  defaultCpuWorkers,
  loadConfig,
  renderCacheDir,
  resultsDir,
  sourcesDir,
} from './config'

describe('loadConfig', () => {
  it('uses the defaults from the plan', () => {
    const config = loadConfig({}, 8, '/work')
    expect(config).toMatchObject({
      dataDir: '/work/.data',
      database: 'sqlite',
      cpuWorkers: 4,
      gpuWorkers: 1,
      groupSharePercent: 50,
      maxWaitingJobsPerUser: 200,
      maxUploadBytes: 100 * 1024 * 1024,
      maxBundleBytes: 1024 * 1024 * 1024,
      aiBatchSize: 8,
      jobRetentionDays: 30,
      maxResultBytesPerUser: 20 * 1024 * 1024 * 1024,
      renderCacheBytes: 2 * 1024 * 1024 * 1024,
      rateLimitMultiplier: 1,
      baseUrl: 'http://localhost:3100',
      trustedOrigins: ['http://localhost:3100'],
      realtime: {
        host: '127.0.0.1',
        port: 3101,
        url: 'ws://localhost:3101/realtime',
      },
    })
    expect(config.authSecret).toBeUndefined()
  })

  it('reads how much to loosen the request limits', () => {
    expect(
      loadConfig({ LEMONIFY_RATE_LIMIT_MULTIPLIER: '20' }, 8, '/work')
        .rateLimitMultiplier,
    ).toBe(20)
    expect(() =>
      loadConfig({ LEMONIFY_RATE_LIMIT_MULTIPLIER: '0' }, 8, '/work'),
    ).toThrow(ValidationError)
  })

  describe('email', () => {
    it('sends none unless Resend is set up', () => {
      expect(loadConfig({}, 8, '/work').email).toBeNull()
      expect(
        loadConfig(
          { LEMONIFY_RESEND_API_KEY: ' ', LEMONIFY_EMAIL_FROM: '' },
          8,
          '/work',
        ).email,
      ).toBeNull()
    })

    it('reads the key and the sender', () => {
      expect(
        loadConfig(
          {
            LEMONIFY_RESEND_API_KEY: 're_key',
            LEMONIFY_EMAIL_FROM: 'Lemonify <hello@example.com>',
          },
          8,
          '/work',
        ).email,
      ).toEqual({ apiKey: 're_key', from: 'Lemonify <hello@example.com>' })
    })

    it('needs the key and the sender together', () => {
      expect(() =>
        loadConfig({ LEMONIFY_RESEND_API_KEY: 're_key' }, 8, '/work'),
      ).toThrow(/go together/)
      expect(() =>
        loadConfig({ LEMONIFY_EMAIL_FROM: 'hello@example.com' }, 8, '/work'),
      ).toThrow(/go together/)
    })
  })

  describe('realtime', () => {
    it('listens on its own port and says where tabs reach it, from the site address', () => {
      expect(
        loadConfig(
          {
            LEMONIFY_BASE_URL: 'http://localhost:3200',
            LEMONIFY_REALTIME_PORT: '3201',
          },
          8,
          '/work',
        ).realtime,
      ).toEqual({
        host: '127.0.0.1',
        port: 3201,
        url: 'ws://localhost:3201/realtime',
      })
    })

    it('uses a secure address when the site is served securely', () => {
      expect(
        loadConfig(
          { LEMONIFY_BASE_URL: 'https://lemon.example.com' },
          8,
          '/work',
        ).realtime.url,
      ).toBe('wss://lemon.example.com:3101/realtime')
    })

    it('takes the address tabs reach it at, as when a proxy serves it on the site’s own port', () => {
      expect(
        loadConfig(
          {
            LEMONIFY_BASE_URL: 'https://lemon.example.com',
            LEMONIFY_REALTIME_URL: 'wss://lemon.example.com/realtime',
            LEMONIFY_REALTIME_HOST: '0.0.0.0',
          },
          8,
          '/work',
        ).realtime,
      ).toEqual({
        host: '0.0.0.0',
        port: 3101,
        url: 'wss://lemon.example.com/realtime',
      })
    })

    it('refuses an address that is not a websocket one', () => {
      expect(() =>
        loadConfig(
          { LEMONIFY_REALTIME_URL: 'http://localhost:3101/realtime' },
          8,
          '/work',
        ),
      ).toThrow(/LEMONIFY_REALTIME_URL/)
    })

    it('refuses an unencrypted address for a site served securely', () => {
      expect(() =>
        loadConfig(
          {
            LEMONIFY_BASE_URL: 'https://lemon.example.com',
            LEMONIFY_REALTIME_URL: 'ws://lemon.example.com/realtime',
          },
          8,
          '/work',
        ),
      ).toThrow(/wss/)
    })

    it('refuses the site’s own port, which the website already listens on', () => {
      expect(() =>
        loadConfig({ LEMONIFY_REALTIME_PORT: '3100' }, 8, '/work'),
      ).toThrow(/LEMONIFY_REALTIME_PORT/)
    })

    it('refuses a port that is not one', () => {
      for (const port of ['0', '70000', 'abc']) {
        expect(() =>
          loadConfig({ LEMONIFY_REALTIME_PORT: port }, 8, '/work'),
        ).toThrow(ValidationError)
      }
    })
  })

  it('sizes the CPU pool from the CPU count, between 1 and 4', () => {
    expect(defaultCpuWorkers(0)).toBe(1)
    expect(defaultCpuWorkers(2)).toBe(2)
    expect(defaultCpuWorkers(64)).toBe(4)
  })

  it('reads values from the environment', () => {
    const config = loadConfig(
      {
        LEMONIFY_DATA_DIR: 'store',
        LEMONIFY_CPU_WORKERS: '3',
        LEMONIFY_GPU_WORKERS: '2',
        LEMONIFY_GROUP_SHARE: '25',
        LEMONIFY_BASE_URL: 'https://lemonify.example/app',
        LEMONIFY_TRUSTED_ORIGINS: 'https://a.example, https://b.example/x',
        LEMONIFY_AUTH_SECRET: 's'.repeat(32),
      },
      8,
      '/work',
    )
    expect(config.dataDir).toBe('/work/store')
    expect(config.cpuWorkers).toBe(3)
    expect(config.gpuWorkers).toBe(2)
    expect(config.groupSharePercent).toBe(25)
    expect(config.trustedOrigins).toEqual([
      'https://lemonify.example',
      'https://a.example',
      'https://b.example',
    ])
    expect(config.authSecret).toHaveLength(32)
  })

  it('rejects bad values with a message that names the variable', () => {
    expect(() => loadConfig({ LEMONIFY_GROUP_SHARE: '0' })).toThrow(
      ValidationError,
    )
    expect(() => loadConfig({ LEMONIFY_GROUP_SHARE: '101' })).toThrow(
      /LEMONIFY_GROUP_SHARE/,
    )
    expect(() => loadConfig({ LEMONIFY_CPU_WORKERS: 'many' })).toThrow(
      /LEMONIFY_CPU_WORKERS/,
    )
    expect(() => loadConfig({ LEMONIFY_DATABASE: 'postgres' })).toThrow(
      /LEMONIFY_DATABASE/,
    )
    expect(() => loadConfig({ LEMONIFY_AUTH_SECRET: 'short' })).toThrow(
      /LEMONIFY_AUTH_SECRET/,
    )
    expect(() => loadConfig({ LEMONIFY_BASE_URL: 'not a url' })).toThrow(
      /LEMONIFY_BASE_URL/,
    )
  })

  it('places the database and file stores under the data directory', () => {
    const config = { dataDir: '/data' }
    expect(databaseFile(config)).toBe(path.join('/data', 'lemonify.sqlite'))
    expect(sourcesDir(config)).toBe(path.join('/data', 'sources'))
    expect(resultsDir(config)).toBe(path.join('/data', 'results'))
    expect(renderCacheDir(config)).toBe(path.join('/data', 'render-cache'))
  })
})
