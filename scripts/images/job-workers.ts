import type { App } from '../../src/server/composition.ts'
import { webServerAnswers } from '../../src/server/channel/channel-probe.ts'
import { channelSocketPath } from '../../src/server/config/config.ts'

/** How often a command that left its jobs to the web server checks that it is still there. */
const DEFAULT_WATCH_MS = 2000

export type WithWorkersOptions = {
  watchMs?: number
}

/**
 * Runs `work`, a command's queuing of jobs and wait for their results, with
 * something to do those jobs (decision 6, CLI). When a web server is running
 * on the data folder (its socket answers), its worker pool does them: the
 * command queues them, says so through the socket and waits, so however many
 * commands run, no more jobs run at once than the pool allows. When no web
 * server is running, or the one that was stops while the command waits, this
 * process takes the jobs from the queue itself, with the same pools and
 * fairness rules. Jobs it did not finish stay in the queue for the server or
 * a `worker`.
 */
export async function withWorkers<T>(
  app: App,
  work: () => Promise<T>,
  options: WithWorkersOptions = {},
): Promise<T> {
  const socketPath = channelSocketPath(app.config)
  let local: Promise<void> | undefined
  const runHere = (): Promise<void> => {
    local ??= app.scheduler.start()
    return local
  }
  let watch: ReturnType<typeof setInterval> | undefined
  let watching = false
  const stopWatching = (): void => {
    if (watch !== undefined) clearInterval(watch)
    watch = undefined
  }
  if (await webServerAnswers(socketPath)) {
    watch = setInterval(() => {
      if (watching) return
      watching = true
      webServerAnswers(socketPath)
        .catch(() => false)
        .then(async (answers) => {
          if (answers || watch === undefined) return
          stopWatching()
          await runHere()
        })
        .finally(() => {
          watching = false
        })
    }, options.watchMs ?? DEFAULT_WATCH_MS)
    watch.unref()
  } else {
    await runHere()
  }
  try {
    return await work()
  } finally {
    stopWatching()
    if (local !== undefined) {
      await local
      await app.scheduler.stop()
    }
  }
}
