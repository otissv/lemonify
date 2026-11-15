import { batchKeyOf } from './job-types.ts'
import type { JobRecord } from './job-types.ts'

export type FairnessRules = {
  /** Slots in the pool being filled. */
  slots: number
  /** The most of the pool's slots one group (a Document or workflow run) may hold while others wait. */
  groupSharePercent: number
}

function maxPerGroup({ slots, groupSharePercent }: FairnessRules): number {
  return Math.max(1, Math.floor((slots * groupSharePercent) / 100))
}

function bestPriority(jobs: ReadonlyArray<JobRecord>): number {
  let best = Number.POSITIVE_INFINITY
  for (const job of jobs) best = Math.min(best, job.priority)
  return best
}

function startedEarlier(a: JobRecord, b: JobRecord): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

/**
 * Chooses the next Job for a free slot. Priority is strict: a lower number
 * always goes first. Among Jobs of the best priority, a group already holding
 * its share of the slots is passed over while another group could use the
 * slot (so one Document or run cannot hog the pool). Then the group running
 * the fewest Jobs goes first, and among equals the group served longest ago,
 * so groups take turns however long each one's queue is; the oldest Job of
 * that group goes first. When every waiting group is
 * at its share, the share is ignored rather than leaving a slot idle.
 */
export function pickNextJob(
  waiting: ReadonlyArray<JobRecord>,
  runningByGroup: ReadonlyMap<string, number>,
  /** When each group was last served, as an ever-rising number; a group never served counts as the longest ago. */
  lastServed: ReadonlyMap<string, number>,
  rules: FairnessRules,
): JobRecord | undefined {
  if (waiting.length === 0) return undefined
  const priority = bestPriority(waiting)
  const best = waiting.filter((job) => job.priority === priority)
  const cap = maxPerGroup(rules)
  const running = (job: JobRecord): number =>
    runningByGroup.get(job.groupKey) ?? 0
  const served = (job: JobRecord): number => lastServed.get(job.groupKey) ?? 0
  const underShare = best.filter((job) => running(job) < cap)
  const candidates = underShare.length > 0 ? underShare : best
  const ordered = [...candidates].sort(
    (a, b) =>
      running(a) - running(b) || served(a) - served(b) || startedEarlier(a, b),
  )
  return ordered[0]
}

/**
 * The waiting Jobs that can run in the same batch as `primary`: the same
 * pool and kind and an equal batch key, oldest first, so that at most `max` Jobs
 * (the primary included) run together.
 */
export function pickBatchCompanions(
  primary: JobRecord,
  waiting: ReadonlyArray<JobRecord>,
  max: number,
): JobRecord[] {
  const key = batchKeyOf(primary)
  if (key === undefined || max <= 1) return []
  const companions = waiting
    .filter(
      (job) =>
        job.id !== primary.id &&
        job.kind === primary.kind &&
        job.pool === primary.pool &&
        batchKeyOf(job) === key,
    )
    .sort(startedEarlier)
  return companions.slice(0, max - 1)
}
