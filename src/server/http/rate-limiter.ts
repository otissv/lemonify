export type RateLimit = {
  limit: number
  windowMs: number
}

/** How strictly each kind of request is limited; upload and queueing are stricter. */
export const RATE_LIMITS = {
  default: { limit: 300, windowMs: 60_000 },
  queue: { limit: 120, windowMs: 60_000 },
  upload: { limit: 30, windowMs: 60_000 },
} as const satisfies Record<string, RateLimit>

export type RateLimitKind = keyof typeof RATE_LIMITS

export type RateDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }

type Window = { startedAt: number; count: number }

const MAX_TRACKED_KEYS = 50_000
const MS_PER_SECOND = 1000

/**
 * Counts requests per key in fixed windows, in this process's memory. That is
 * enough because the plan runs one web server process per machine; the
 * per-User waiting-Jobs limit in the database is the one that spans
 * processes.
 */
export class FixedWindowRateLimiter {
  readonly #windows = new Map<string, Window>()
  readonly #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  take(key: string, { limit, windowMs }: RateLimit): RateDecision {
    const now = this.#now()
    const current = this.#windows.get(key)
    if (current === undefined || now - current.startedAt >= windowMs) {
      this.#remember(key, { startedAt: now, count: 1 })
      return { allowed: true }
    }
    if (current.count >= limit) {
      const waitMs = current.startedAt + windowMs - now
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(waitMs / MS_PER_SECOND)),
      }
    }
    current.count += 1
    return { allowed: true }
  }

  #remember(key: string, window: Window): void {
    if (this.#windows.size >= MAX_TRACKED_KEYS) this.#dropOldest()
    this.#windows.set(key, window)
  }

  #dropOldest(): void {
    const oldest = this.#windows.keys().next()
    if (!oldest.done) this.#windows.delete(oldest.value)
  }
}
