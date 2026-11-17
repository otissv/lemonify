import type { RealtimeEvent } from '@/features/realtime/realtime-events'

/**
 * How a service says that something a person can see has changed, so their
 * open tabs can read it again. It never throws and never waits: telling the
 * tabs is not part of the change, and a change that was saved is not undone
 * because a tab could not be told.
 */
export interface ChangePublisher {
  publish(userId: string, event: RealtimeEvent): void
}
