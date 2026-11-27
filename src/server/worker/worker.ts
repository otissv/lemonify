import type { Knex } from 'knex'

import { WorkerPool } from '@/features/ai/ai-tools'

import { SocketChangePublisher } from '../channel/socket-change-publisher.ts'
import { connectDatabase, prepareDataDirectories } from '../compose/database.ts'
import { buildJobCore } from '../compose/job-core.ts'
import type { JobCoreDeps } from '../compose/job-core.ts'
import { channelSocketPath } from '../config/config.ts'
import type { Config } from '../config/config.ts'
import { systemClock, uuidGenerator } from '../domain/clock.ts'
import type { Clock, IdGenerator } from '../domain/clock.ts'
import { consoleLogger } from '../http/logger.ts'
import type { Logger } from '../http/logger.ts'
import type { Scheduler } from '../jobs/scheduler.ts'
import type { ChangePublisher } from '../realtime/change-publisher.ts'

/**
 * Connections each worker keeps open: one for the job's own reads and writes,
 * one for the scheduler's claims, progress and cancel checks. Small, so every
 * process's pool together stays inside Postgres's connection limit.
 */
export const WORKER_DATABASE_POOL_SIZE = 2

/** A worker runs one job at a time; the GPU worker batches AI jobs inside its one. */
const WORKER_SLOTS = 1

/** Parts a test can replace; the real ones are built from the configuration. */
export type WorkerOverrides = Pick<JobCoreDeps, 'imageEngine' | 'aiEngine'> & {
  clock?: Clock
  ids?: IdGenerator
  logger?: Logger
  /** Where the job's changes go; the web server's socket unless a test listens instead. */
  changes?: ChangePublisher
}

export type Worker = {
  pool: WorkerPool
  database: Knex
  scheduler: Scheduler
  /** Starts taking jobs of its pool from the queue. */
  start(): Promise<void>
  /** Takes no more jobs, lets the one running finish, then closes the socket and the database. */
  close(): Promise<void>
}

type Outbox = { changes: ChangePublisher; close(): Promise<void> }

/** Where the jobs' changes go, and how to send what is still waiting when the worker closes. */
function changesOf(
  config: Config,
  logger: Logger,
  replaced: ChangePublisher | undefined,
): Outbox {
  if (replaced !== undefined)
    return { changes: replaced, close: async () => {} }
  const socket = new SocketChangePublisher(channelSocketPath(config), logger)
  return { changes: socket, close: () => socket.close() }
}

function slotsFor(pool: WorkerPool): Record<WorkerPool, number> {
  return {
    [WorkerPool.Cpu]: pool === WorkerPool.Cpu ? WORKER_SLOTS : 0,
    [WorkerPool.Gpu]: pool === WorkerPool.Gpu ? WORKER_SLOTS : 0,
  }
}

/**
 * The services a job needs, and a scheduler that runs the jobs of one pool,
 * for a worker process (decision 1, worker processes; decision 2, pool
 * shape). It has no web server, no realtime server and no sign-in: what its
 * jobs change goes to the web server's socket, which tells the open tabs.
 */
export async function createWorker(
  config: Config,
  pool: WorkerPool,
  overrides: WorkerOverrides = {},
): Promise<Worker> {
  prepareDataDirectories(config)
  const database = await connectDatabase({
    ...config.database,
    poolSize: WORKER_DATABASE_POOL_SIZE,
  })
  const logger = overrides.logger ?? consoleLogger
  const outbox = changesOf(config, logger, overrides.changes)
  const { scheduler } = buildJobCore({
    config,
    database,
    clock: overrides.clock ?? systemClock,
    ids: overrides.ids ?? uuidGenerator,
    logger,
    changes: outbox.changes,
    imageEngine: overrides.imageEngine,
    aiEngine: overrides.aiEngine,
    slots: slotsFor(pool),
  })
  let closing: Promise<void> | undefined
  return {
    pool,
    database,
    scheduler,
    start: () => scheduler.start(),
    close() {
      closing ??= (async () => {
        await scheduler.stop()
        await outbox.close()
        await database.destroy()
      })()
      return closing
    },
  }
}
