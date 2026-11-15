import type { App } from '../../src/server/composition.ts'

/**
 * Runs `work` while this process takes Jobs from the shared queue, using the
 * same pools and fairness rules as the server. A command that queues Jobs and
 * waits for them uses it, so the CLI works with no server and no `worker`
 * process. Jobs this process did not finish stay in the queue for the server
 * or a `worker` to pick up.
 */
export async function withWorkers<T>(
  app: App,
  work: () => Promise<T>,
): Promise<T> {
  await app.scheduler.start()
  try {
    return await work()
  } finally {
    await app.scheduler.stop()
  }
}
