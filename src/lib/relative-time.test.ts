import { describe, expect, it } from 'vitest'

import { relativeTime } from '@/lib/relative-time'

const NOW = new Date('2026-03-20T12:00:00.000Z')

function ago(milliseconds: number): string {
  return new Date(NOW.getTime() - milliseconds).toISOString()
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('relativeTime', () => {
  it('says just now for under a minute', () => {
    expect(relativeTime(ago(0), NOW)).toBe('just now')
    expect(relativeTime(ago(59_000), NOW)).toBe('just now')
  })

  it('counts minutes', () => {
    expect(relativeTime(ago(MINUTE), NOW)).toBe('1 minute ago')
    expect(relativeTime(ago(5 * MINUTE), NOW)).toBe('5 minutes ago')
  })

  it('counts hours', () => {
    expect(relativeTime(ago(HOUR), NOW)).toBe('1 hour ago')
    expect(relativeTime(ago(3 * HOUR), NOW)).toBe('3 hours ago')
  })

  it('says yesterday for a day ago', () => {
    expect(relativeTime(ago(DAY), NOW)).toBe('yesterday')
    expect(relativeTime(ago(DAY + 5 * HOUR), NOW)).toBe('yesterday')
  })

  it('counts days up to a week', () => {
    expect(relativeTime(ago(2 * DAY), NOW)).toBe('2 days ago')
    expect(relativeTime(ago(6 * DAY), NOW)).toBe('6 days ago')
  })

  it('writes the date after a week', () => {
    expect(relativeTime(ago(7 * DAY), NOW)).toMatch(/^\d{1,2} Mar 2026$/)
    expect(relativeTime(ago(90 * DAY), NOW)).toMatch(/^\d{1,2} Dec 2025$/)
  })

  it('treats a time in the future as just now', () => {
    expect(relativeTime(ago(-5 * MINUTE), NOW)).toBe('just now')
  })
})
