import type { Actor } from './actor.ts'

const JOB_ACTOR_NAME = 'job'

/** The acting User for work that runs without a request, such as a queued Job. Ownership was checked when the Job was queued. */
export function actorForOwner(ownerId: string): Actor {
  return { userId: ownerId, name: JOB_ACTOR_NAME }
}
