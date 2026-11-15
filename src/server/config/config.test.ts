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
      aiBatchSize: 8,
      jobRetentionDays: 30,
      maxResultBytesPerUser: 20 * 1024 * 1024 * 1024,
      renderCacheBytes: 2 * 1024 * 1024 * 1024,
      baseUrl: 'http://localhost:3100',
      trustedOrigins: ['http://localhost:3100'],
    })
    expect(config.authSecret).toBeUndefined()
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
