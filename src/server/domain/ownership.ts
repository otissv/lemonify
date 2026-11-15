import { NotFoundError } from '../errors.ts'
import type { Actor } from './actor.ts'

/**
 * A User may touch only their own records. A record that belongs to someone
 * else is reported exactly like one that does not exist, so ownership never
 * reveals what exists.
 */
export function requireOwned<T extends { ownerId: string }>(
  actor: Actor,
  record: T | null,
  missing: string,
): T {
  if (record === null || record.ownerId !== actor.userId) {
    throw new NotFoundError(missing)
  }
  return record
}
