import { describe, expect, it } from 'vitest'

import { WorkerPool } from '@/features/ai/ai-tools'

import { loadConfig } from '../config/config'
import {
  LOWEST_PRIORITY,
  WORKER_THREADPOOL_SIZE,
  imageThreadsPerWorker,
  workerEnvironment,
  workerPriority,
} from './worker-environment'

const CONFIG = loadConfig(
  {
    POSTGRES_HOST: 'db.internal',
    POSTGRES_PORT: '5544',
    POSTGRES_USER: 'lemonify',
    POSTGRES_PASSWORD: 'secret',
    POSTGRES_DATABASE: 'lemonify_web',
    POSTGRES_SCHEMA: 'public',
    LEMONIFY_DATA_DIR: 'store',
    LEMONIFY_CPU_WORKERS: '3',
    LEMONIFY_GPU_WORKERS: '1',
  },
  8,
  '/srv/lemonify',
)

describe('the environment a worker process starts with', () => {
  it('sizes its helper thread pool for the work of its pool, before the process starts', () => {
    for (const pool of [WorkerPool.Cpu, WorkerPool.Gpu]) {
      expect(workerEnvironment(pool, CONFIG, {}).UV_THREADPOOL_SIZE).toBe(
        String(WORKER_THREADPOOL_SIZE[pool]),
      )
    }
  })

  it('keeps the rest of the environment, but not a thread pool size of its own', () => {
    const environment = workerEnvironment(WorkerPool.Cpu, CONFIG, {
      LEMONIFY_GROUP_SHARE: '25',
      UV_THREADPOOL_SIZE: '128',
    })
    expect(environment.LEMONIFY_GROUP_SHARE).toBe('25')
    expect(environment.UV_THREADPOOL_SIZE).toBe(
      String(WORKER_THREADPOOL_SIZE[WorkerPool.Cpu]),
    )
  })

  it('points the worker at the web server’s database, data folder and worker counts, whatever the environment says', () => {
    const environment = workerEnvironment(WorkerPool.Cpu, CONFIG, {
      POSTGRES_DATABASE: 'other',
      LEMONIFY_DATA_DIR: 'elsewhere',
      LEMONIFY_CPU_WORKERS: '9',
    })
    expect(environment).toMatchObject({
      POSTGRES_HOST: 'db.internal',
      POSTGRES_PORT: '5544',
      POSTGRES_DATABASE: 'lemonify_web',
      LEMONIFY_DATA_DIR: '/srv/lemonify/store',
      LEMONIFY_CPU_WORKERS: '3',
      LEMONIFY_GPU_WORKERS: '1',
    })
  })
})

describe('the priority a worker runs at', () => {
  it('is lower than the web server’s, so the server answers first while every worker is busy', () => {
    expect(workerPriority(0)).toBeGreaterThan(0)
    expect(workerPriority(5)).toBeGreaterThan(5)
  })

  it('is at most the lowest there is', () => {
    expect(workerPriority(16)).toBe(LOWEST_PRIORITY)
    expect(workerPriority(LOWEST_PRIORITY)).toBe(LOWEST_PRIORITY)
  })
})

describe('the image threads of a CPU worker', () => {
  it('share the cores the web server does not keep between the CPU workers', () => {
    expect(imageThreadsPerWorker(24, 4)).toBe(5)
    expect(imageThreadsPerWorker(16, 4)).toBe(3)
    expect(imageThreadsPerWorker(12, 2)).toBe(4)
  })

  it('are at least one, however many workers there are', () => {
    expect(imageThreadsPerWorker(2, 4)).toBe(1)
    expect(imageThreadsPerWorker(1, 1)).toBe(1)
  })
})
