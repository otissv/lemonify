import { fork } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import path from 'node:path'

import type { WorkerPool } from '@/features/ai/ai-tools'

import type { Config } from '../config/config.ts'
import type { Logger } from '../http/logger.ts'
import { consoleLogger } from '../http/logger.ts'
import { workerEnvironment } from './worker-environment.ts'
import { readWorkerMessage } from './worker-messages.ts'
import type { SupervisorMessage, WorkerMessage } from './worker-messages.ts'

/** The worker's entry, from the project folder, which the web server and the CLI run from. */
export const WORKER_ENTRY = path.join(
  process.cwd(),
  'src',
  'server',
  'worker',
  'main.ts',
)

/** Node's flags for the project's own TypeScript, as the CLI starts with. */
export const WORKER_EXEC_ARGV: ReadonlyArray<string> = [
  '--disable-warning=ExperimentalWarning',
  '--experimental-transform-types',
  '--import',
  path.join(process.cwd(), 'scripts', 'images', 'register-alias.ts'),
]

/** How a worker process ended: its exit code, or the signal that ended it; both null when it never started. */
export type WorkerExit = {
  code: number | null
  signal: NodeJS.Signals | null
}

/** A running worker process, as the supervisor uses it. */
export interface WorkerProcess {
  /** Undefined when the process could not be started. */
  readonly pid: number | undefined
  /** Sends a message; one sent to a process that is going away is dropped. */
  send(message: SupervisorMessage): void
  /** Asks it to stop taking jobs and finish the one it runs (SIGTERM). */
  stop(): void
  /** Ends it at once (SIGKILL). */
  kill(): void
  onMessage(listener: (message: WorkerMessage) => void): void
  /** Called once, when it has exited or could not be started. */
  onExit(listener: (exit: WorkerExit) => void): void
}

/** Starts a worker process for a pool. */
export type StartWorker = (pool: WorkerPool) => WorkerProcess

export type ForkOptions = {
  /** Keeps the worker's output out of this process's; for tests. Otherwise its log lines join the web server's. */
  quiet?: boolean
  logger?: Logger
}

class ForkedWorker implements WorkerProcess {
  readonly #child: ChildProcess
  readonly #logger: Logger
  #exited = false
  #onExit: (exit: WorkerExit) => void = () => {}

  constructor(child: ChildProcess, pool: WorkerPool, logger: Logger) {
    this.#child = child
    this.#logger = logger
    child.once('exit', (code, signal) => this.#ended({ code, signal }))
    child.on('error', (error) => {
      logger.error('A worker process failed', {
        pool,
        pid: child.pid ?? null,
        detail: error.message,
      })
      // A process that never started sends no exit.
      if (child.pid === undefined) this.#ended({ code: null, signal: null })
    })
  }

  get pid(): number | undefined {
    return this.#child.pid
  }

  send(message: SupervisorMessage): void {
    if (!this.#child.connected) return
    this.#child.send(message, (error) => {
      if (error === null) return
      this.#logger.warn('A message to a worker was not delivered', {
        pid: this.pid ?? null,
        detail: error.message,
      })
    })
  }

  stop(): void {
    if (!this.#exited) this.#child.kill('SIGTERM')
  }

  kill(): void {
    if (!this.#exited) this.#child.kill('SIGKILL')
  }

  onMessage(listener: (message: WorkerMessage) => void): void {
    this.#child.on('message', (value) => {
      const message = readWorkerMessage(value)
      if (message === undefined) {
        this.#logger.warn('A worker sent a message the pool does not take', {
          pid: this.pid ?? null,
        })
        return
      }
      listener(message)
    })
  }

  onExit(listener: (exit: WorkerExit) => void): void {
    this.#onExit = listener
  }

  #ended(exit: WorkerExit): void {
    if (this.#exited) return
    this.#exited = true
    this.#onExit(exit)
  }
}

/** Starts worker processes with `child_process.fork` on the web server's configuration (decision 1, worker processes). */
export function forkWorker(
  config: Config,
  options: ForkOptions = {},
): StartWorker {
  const logger = options.logger ?? consoleLogger
  return (pool) =>
    new ForkedWorker(
      fork(WORKER_ENTRY, [pool], {
        cwd: process.cwd(),
        env: workerEnvironment(pool, config, process.env),
        execArgv: [...WORKER_EXEC_ARGV],
        stdio: options.quiet
          ? ['ignore', 'ignore', 'ignore', 'ipc']
          : ['ignore', 'inherit', 'inherit', 'ipc'],
      }),
      pool,
      logger,
    )
}
