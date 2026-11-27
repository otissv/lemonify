import { WorkerPool } from '@/features/ai/ai-tools'

import {
  CORES_KEPT_FOR_WEB_SERVER,
  databaseEnvironment,
} from '../config/config.ts'
import type { Config } from '../config/config.ts'

/**
 * Node's helper threads (`UV_THREADPOOL_SIZE`) for each kind of worker. Sharp
 * runs each image on one of them and file reads and writes use the rest. A
 * CPU worker runs one job at a time, so one thread works on the image and
 * three are left for its files, which a busy image can then never starve. The
 * GPU worker's AI tool runs as a separate program, so its threads only move
 * files. The size is read once, when the process starts, so it is set in the
 * environment the process is started with.
 */
export const WORKER_THREADPOOL_SIZE: Readonly<Record<WorkerPool, number>> = {
  [WorkerPool.Cpu]: 4,
  [WorkerPool.Gpu]: 4,
}

/**
 * The environment to start a worker of `pool` with: this process's, pointed
 * at the database and data folder the web server uses and told how many
 * workers there are (so its share of the cores is right), with the worker's
 * thread pool size. The rest of the configuration the worker reads from the
 * same environment and `.env` the web server read.
 */
export function workerEnvironment(
  pool: WorkerPool,
  config: Config,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    ...databaseEnvironment(config.database),
    LEMONIFY_DATA_DIR: config.dataDir,
    LEMONIFY_CPU_WORKERS: String(config.cpuWorkers),
    LEMONIFY_GPU_WORKERS: String(config.gpuWorkers),
    UV_THREADPOOL_SIZE: String(WORKER_THREADPOOL_SIZE[pool]),
  }
}

/** The lowest scheduling priority (the highest niceness) a process can have. */
export const LOWEST_PRIORITY = 19

/** How much lower than the web server a worker runs. */
const WORKER_PRIORITY_STEP = 10

/**
 * The priority (niceness) a worker runs at, given the web server's. The
 * workers share every core between them, so at the server's own priority a
 * long render leaves its requests waiting for the CPU; ten steps lower, the
 * operating system runs the server first whenever it has work, and the
 * workers have the cores the rest of the time (decision 1, worker processes).
 */
export function workerPriority(serverPriority: number): number {
  return Math.min(serverPriority + WORKER_PRIORITY_STEP, LOWEST_PRIORITY)
}

/**
 * How many threads Sharp may use for one image in a CPU worker: the cores the
 * web server does not keep (`CORES_KEPT_FOR_WEB_SERVER`), shared between the
 * CPU workers, so together they never take the cores its requests need.
 */
export function imageThreadsPerWorker(
  cpuCount: number,
  cpuWorkers: number,
): number {
  return Math.max(
    1,
    Math.floor(
      (cpuCount - CORES_KEPT_FOR_WEB_SERVER) / Math.max(1, cpuWorkers),
    ),
  )
}
