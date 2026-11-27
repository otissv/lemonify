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
import { imageThreadsPerWorker, workerPriority } from './worker-environment.ts'
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
  // Started at the web server's priority; lowered before any image thread is made, as threads take it from this one.
  const startedAtPriority = os.getPriority()
  const priority = workerPriority(startedAtPriority)
  os.setPriority(priority)
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
    consoleLogger.info('Worker stopping', { pool, pid: process.pid })
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
      // Its job is finished and its database and socket are closed: nothing is left to do. End
      // the process rather than wait for every handle (the channel to the process that started
      // it, a driver's socket) to let go, which under load was seen to keep a stopped worker alive.
      .finally(() => {
        consoleLogger.info('Worker stopped', { pool, pid: process.pid })
        if (process.connected) process.disconnect()
        process.exit()
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
  consoleLogger.info('Worker started', {
    pool,
    pid: process.pid,
    priority,
    startedAtPriority,
  })
  tell({ type: 'ready' })
}

main().catch((error: unknown) => {
  consoleLogger.error('The worker could not start', { detail: reason(error) })
  process.exitCode = FAILURE_EXIT_CODE
})
