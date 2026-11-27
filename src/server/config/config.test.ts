import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { ValidationError } from '../errors'
import { DEFAULT_SITE_PORT, sitePort } from './site-port'
import {
  defaultCpuWorkers,
  loadConfig,
  renderCacheDir,
  resultsDir,
  sourcesDir,
} from './config'

const POSTGRES = {
  POSTGRES_HOST: '127.0.0.1',
  POSTGRES_PORT: '5433',
  POSTGRES_USER: 'lemon',
  POSTGRES_PASSWORD: 'secret',
  POSTGRES_DATABASE: 'lemonify',
  POSTGRES_SCHEMA: 'public',
}

describe('loadConfig', () => {
  it('uses the defaults from the plan', () => {
    const config = loadConfig({ ...POSTGRES }, 8, '/work')
    expect(config).toMatchObject({
      dataDir: '/work/.data',
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
      baseUrl: 'http://localhost:5173',
      trustedOrigins: ['http://localhost:5173'],
      realtime: {
        host: '127.0.0.1',
        port: 5174,
        url: 'ws://localhost:5174/realtime',
      },
    })
    expect(config.authSecret).toBeUndefined()
  })

  describe("the website's port", () => {
    it('is the port the site and its live-updates server are put on, when none of the addresses are set', () => {
      const config = loadConfig({ ...POSTGRES, PORT: '4000' }, 8, '/work')
      expect(config.baseUrl).toBe('http://localhost:4000')
      expect(config.trustedOrigins).toEqual(['http://localhost:4000'])
      expect(config.realtime).toMatchObject({
        port: 4001,
        url: 'ws://localhost:4001/realtime',
      })
    })

    it('does not decide an address that is set: the base URL, and the live-updates port and address', () => {
      const config = loadConfig(
        {
          ...POSTGRES,
          PORT: '4000',
          LEMONIFY_BASE_URL: 'https://lemon.example.com',
          LEMONIFY_REALTIME_PORT: '9000',
          LEMONIFY_REALTIME_URL: 'wss://lemon.example.com/realtime',
        },
        8,
        '/work',
      )
      expect(config.baseUrl).toBe('https://lemon.example.com')
      expect(config.realtime).toMatchObject({
        port: 9000,
        url: 'wss://lemon.example.com/realtime',
      })
    })

    it('is 5173 when it is not set, and treats a blank value as not set', () => {
      expect(loadConfig({ ...POSTGRES }, 8, '/work').baseUrl).toBe(
        'http://localhost:5173',
      )
      expect(loadConfig({ ...POSTGRES, PORT: '' }, 8, '/work').baseUrl).toBe(
        'http://localhost:5173',
      )
    })

    it('refuses a value that is not a port, naming the variable', () => {
      for (const port of ['0', '70000', 'abc']) {
        expect(() =>
          loadConfig({ ...POSTGRES, PORT: port }, 8, '/work'),
        ).toThrow(/PORT/)
      }
    })

    it('is the same port the dev server listens on', () => {
      expect(sitePort({ PORT: '4000' })).toBe(4000)
      expect(sitePort({})).toBe(DEFAULT_SITE_PORT)
    })
  })

  it('reads how much to loosen the request limits', () => {
    expect(
      loadConfig(
        { ...POSTGRES, LEMONIFY_RATE_LIMIT_MULTIPLIER: '20' },
        8,
        '/work',
      ).rateLimitMultiplier,
    ).toBe(20)
    expect(() =>
      loadConfig(
        { ...POSTGRES, LEMONIFY_RATE_LIMIT_MULTIPLIER: '0' },
        8,
        '/work',
      ),
    ).toThrow(ValidationError)
  })

  describe('email', () => {
    it('sends none unless Resend is set up', () => {
      expect(loadConfig({ ...POSTGRES }, 8, '/work').email).toBeNull()
      expect(
        loadConfig(
          {
            ...POSTGRES,
            LEMONIFY_RESEND_API_KEY: ' ',
            LEMONIFY_EMAIL_FROM: '',
          },
          8,
          '/work',
        ).email,
      ).toBeNull()
    })

    it('reads the key and the sender', () => {
      expect(
        loadConfig(
          {
            ...POSTGRES,
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
        loadConfig(
          { ...POSTGRES, LEMONIFY_RESEND_API_KEY: 're_key' },
          8,
          '/work',
        ),
      ).toThrow(/go together/)
      expect(() =>
        loadConfig(
          { ...POSTGRES, LEMONIFY_EMAIL_FROM: 'hello@example.com' },
          8,
          '/work',
        ),
      ).toThrow(/go together/)
    })
  })

  describe('realtime', () => {
    it('listens on its own port and says where tabs reach it, from the site address', () => {
      expect(
        loadConfig(
          {
            ...POSTGRES,
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
          { ...POSTGRES, LEMONIFY_BASE_URL: 'https://lemon.example.com' },
          8,
          '/work',
        ).realtime.url,
      ).toBe('wss://lemon.example.com:5174/realtime')
    })

    it('takes the address tabs reach it at, as when a proxy serves it on the site’s own port', () => {
      expect(
        loadConfig(
          {
            ...POSTGRES,
            LEMONIFY_BASE_URL: 'https://lemon.example.com',
            LEMONIFY_REALTIME_URL: 'wss://lemon.example.com/realtime',
            LEMONIFY_REALTIME_HOST: '0.0.0.0',
          },
          8,
          '/work',
        ).realtime,
      ).toEqual({
        host: '0.0.0.0',
        port: 5174,
        url: 'wss://lemon.example.com/realtime',
      })
    })

    it('refuses an address that is not a websocket one', () => {
      expect(() =>
        loadConfig(
          {
            ...POSTGRES,
            LEMONIFY_REALTIME_URL: 'http://localhost:3101/realtime',
          },
          8,
          '/work',
        ),
      ).toThrow(/LEMONIFY_REALTIME_URL/)
    })

    it('refuses an unencrypted address for a site served securely', () => {
      expect(() =>
        loadConfig(
          {
            ...POSTGRES,
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
        loadConfig({ ...POSTGRES, LEMONIFY_REALTIME_PORT: '5173' }, 8, '/work'),
      ).toThrow(/LEMONIFY_REALTIME_PORT/)
      expect(() =>
        loadConfig(
          { ...POSTGRES, PORT: '4000', LEMONIFY_REALTIME_PORT: '4000' },
          8,
          '/work',
        ),
      ).toThrow(/LEMONIFY_REALTIME_PORT/)
      expect(() =>
        loadConfig(
          {
            ...POSTGRES,
            LEMONIFY_BASE_URL: 'http://localhost:4000',
            LEMONIFY_REALTIME_PORT: '4000',
          },
          8,
          '/work',
        ),
      ).toThrow(/LEMONIFY_REALTIME_PORT/)
    })

    it('refuses a port that is not one', () => {
      for (const port of ['0', '70000', 'abc']) {
        expect(() =>
          loadConfig({ ...POSTGRES, LEMONIFY_REALTIME_PORT: port }, 8, '/work'),
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
        ...POSTGRES,
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
    expect(() =>
      loadConfig({ ...POSTGRES, LEMONIFY_GROUP_SHARE: '0' }),
    ).toThrow(ValidationError)
    expect(() =>
      loadConfig({ ...POSTGRES, LEMONIFY_GROUP_SHARE: '101' }),
    ).toThrow(/LEMONIFY_GROUP_SHARE/)
    expect(() =>
      loadConfig({ ...POSTGRES, LEMONIFY_CPU_WORKERS: 'many' }),
    ).toThrow(/LEMONIFY_CPU_WORKERS/)
    expect(() =>
      loadConfig({ ...POSTGRES, LEMONIFY_AUTH_SECRET: 'short' }),
    ).toThrow(/LEMONIFY_AUTH_SECRET/)
    expect(() =>
      loadConfig({ ...POSTGRES, LEMONIFY_BASE_URL: 'not a url' }),
    ).toThrow(/LEMONIFY_BASE_URL/)
  })

  describe('the database', () => {
    it('is the Postgres server the POSTGRES_ settings name, with a pool of 10 connections by default', () => {
      expect(loadConfig({ ...POSTGRES }, 8, '/work').database).toEqual({
        host: '127.0.0.1',
        port: 5433,
        user: 'lemon',
        password: 'secret',
        database: 'lemonify',
        schema: 'public',
        poolSize: 10,
      })
    })

    it('takes its pool size from LEMONIFY_DATABASE_POOL_SIZE', () => {
      const config = loadConfig(
        { ...POSTGRES, LEMONIFY_DATABASE_POOL_SIZE: '3' },
        8,
        '/work',
      )
      expect(config.database.poolSize).toBe(3)
    })

    it.each([
      'POSTGRES_HOST',
      'POSTGRES_PORT',
      'POSTGRES_USER',
      'POSTGRES_PASSWORD',
      'POSTGRES_DATABASE',
      'POSTGRES_SCHEMA',
    ])('refuses to start without %s, naming it', (name) => {
      const environment: Record<string, string> = { ...POSTGRES }
      delete environment[name]
      expect(() => loadConfig(environment, 8, '/work')).toThrow(
        new RegExp(name),
      )
    })

    it('refuses a port or pool size that is not a positive whole number', () => {
      expect(() =>
        loadConfig({ ...POSTGRES, POSTGRES_PORT: 'five' }, 8, '/work'),
      ).toThrow(/POSTGRES_PORT/)
      expect(() =>
        loadConfig(
          { ...POSTGRES, LEMONIFY_DATABASE_POOL_SIZE: '0' },
          8,
          '/work',
        ),
      ).toThrow(/LEMONIFY_DATABASE_POOL_SIZE/)
    })
  })

  it('places the file stores under the data directory', () => {
    const config = { dataDir: '/data' }
    expect(sourcesDir(config)).toBe(path.join('/data', 'sources'))
    expect(resultsDir(config)).toBe(path.join('/data', 'results'))
    expect(renderCacheDir(config)).toBe(path.join('/data', 'render-cache'))
  })
})
