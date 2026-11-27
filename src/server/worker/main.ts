/**
 * A worker process (decision 1, worker processes): started by the web
 * server's pool with `child_process.fork` and the pool it serves as its one
 * argument (`cpu` or `gpu`). It runs that pool's jobs until it is told to
 * stop (SIGTERM or SIGINT) or the process that started it goes away, then
 * lets the job it is running finish and exits. Over `fork`'s channel it says
 * when it is ready and when it is stopping, and it looks for a job at once
 * when the pool says one was queued.
 */
import os from 'node:os'

import sharp from 'sharp'
import { z } from 'zod'

import { WorkerPool } from '@/features/ai/ai-tools'

import { loadConfig } from '../config/config.ts'
import { readEnvironment } from '../config/environment.ts'
import { consoleLogger } from '../http/logger.ts'
import { imageThreadsPerWorker } from './worker-environment.ts'
import { readSupervisorMessage } from './worker-messages.ts'
import type { WorkerMessage } from './worker-messages.ts'
import { createWorker } from './worker.ts'

const USAGE_EXIT_CODE = 2
const FAILURE_EXIT_CODE = 1

const PoolSchema = z.enum(WorkerPool)

function poolArgument(): WorkerPool | undefined {
  const parsed = PoolSchema.safeParse(process.argv[2])
  if (parsed.success) return parsed.data
  consoleLogger.error('A worker needs the pool it serves', {
    given: process.argv[2] ?? null,
    takes: PoolSchema.options.join(', '),
  })
  return undefined
}

/** Tells the pool that started this process, when one did. */
function tell(message: WorkerMessage): void {
  if (process.connected) process.send?.(message)
}

function reason(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error)
}

async function main(): Promise<void> {
  const pool = poolArgument()
  if (pool === undefined) {
    process.exitCode = USAGE_EXIT_CODE
    return
  }
  const config = loadConfig(readEnvironment())
  if (pool === WorkerPool.Cpu) {
    sharp.concurrency(
      imageThreadsPerWorker(os.availableParallelism(), config.cpuWorkers),
    )
  }
  const worker = await createWorker(config, pool)
  let stopping: Promise<void> | undefined
  const stop = (): void => {
    if (stopping !== undefined) return
    tell({ type: 'stopping' })
    stopping = worker
      .close()
      .catch((error: unknown) => {
        consoleLogger.error('The worker did not stop cleanly', {
          pool,
          detail: reason(error),
        })
        process.exitCode = FAILURE_EXIT_CODE
      })
      // The channel to the process that started this one keeps it alive; let go of it last.
      .finally(() => {
        if (process.connected) process.disconnect()
      })
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  process.once('disconnect', stop)
  process.on('message', (value) => {
    const message = readSupervisorMessage(value)
    if (message === undefined) {
      consoleLogger.warn('The pool sent a message a worker does not take', {
        pool,
      })
      return
    }
    worker.scheduler.wake()
  })
  await worker.start()
  if (stopping !== undefined) return
  consoleLogger.info('Worker started', { pool, pid: process.pid })
  tell({ type: 'ready' })
}

main().catch((error: unknown) => {
  consoleLogger.error('The worker could not start', { detail: reason(error) })
  process.exitCode = FAILURE_EXIT_CODE
})
