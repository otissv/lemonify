import { describe, expect, it } from 'vitest'

import { WorkerPool } from '@/features/ai/ai-tools'

import {
  WORKER_THREADPOOL_SIZE,
  imageThreadsPerWorker,
  workerEnvironment,
} from './worker-environment'

describe('the environment a worker process starts with', () => {
  it('sizes its helper thread pool for the work of its pool, before the process starts', () => {
    for (const pool of [WorkerPool.Cpu, WorkerPool.Gpu]) {
      expect(workerEnvironment(pool, {}).UV_THREADPOOL_SIZE).toBe(
        String(WORKER_THREADPOOL_SIZE[pool]),
      )
    }
  })

  it('keeps the rest of the environment, but not a thread pool size of its own', () => {
    const environment = workerEnvironment(WorkerPool.Cpu, {
      POSTGRES_HOST: '127.0.0.1',
      UV_THREADPOOL_SIZE: '128',
    })
    expect(environment.POSTGRES_HOST).toBe('127.0.0.1')
    expect(environment.UV_THREADPOOL_SIZE).toBe(
      String(WORKER_THREADPOOL_SIZE[WorkerPool.Cpu]),
    )
  })
})

describe('the image threads of a CPU worker', () => {
  it('share the machine’s cores between the CPU workers', () => {
    expect(imageThreadsPerWorker(16, 4)).toBe(4)
    expect(imageThreadsPerWorker(8, 3)).toBe(2)
  })

  it('are at least one, however many workers there are', () => {
    expect(imageThreadsPerWorker(2, 4)).toBe(1)
    expect(imageThreadsPerWorker(1, 1)).toBe(1)
  })
})
