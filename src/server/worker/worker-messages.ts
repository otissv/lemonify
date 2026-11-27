/**
 * What a worker process and the web server's supervisor say to each other
 * over `fork`'s IPC channel. Only these: what a job changed goes to the
 * channel socket (decision 4, live updates) and job progress to the database.
 */
import { z } from 'zod'

/** From a worker: it has started taking jobs, or it has stopped taking them and is finishing the one it runs. */
export const WorkerMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready') }),
  z.strictObject({ type: z.literal('stopping') }),
])

export type WorkerMessage = z.infer<typeof WorkerMessageSchema>

/** From the supervisor: a job of the worker's pool was queued, so look for one now rather than at the next poll. */
export const SupervisorMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('wake') }),
])

export type SupervisorMessage = z.infer<typeof SupervisorMessageSchema>

/** The message a worker sent, or undefined when it is not one. */
export function readWorkerMessage(value: unknown): WorkerMessage | undefined {
  const parsed = WorkerMessageSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** The message the supervisor sent, or undefined when it is not one. */
export function readSupervisorMessage(
  value: unknown,
): SupervisorMessage | undefined {
  const parsed = SupervisorMessageSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}
