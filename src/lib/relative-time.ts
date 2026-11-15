const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`
}

/** How long ago `iso` was, in the short words a recent-items list uses; a week or more ago it is a date. */
export function relativeTime(iso: string, now: Date): string {
  const then = new Date(iso)
  const elapsed = now.getTime() - then.getTime()
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return plural(Math.floor(elapsed / MINUTE), 'minute')
  if (elapsed < DAY) return plural(Math.floor(elapsed / HOUR), 'hour')
  if (elapsed < 2 * DAY) return 'yesterday'
  if (elapsed < WEEK) return plural(Math.floor(elapsed / DAY), 'day')
  return then.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
