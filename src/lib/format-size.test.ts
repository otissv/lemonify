import { describe, expect, it } from 'vitest'

import { formatSize } from '@/lib/format-size'

describe('formatSize', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1 KB'],
    [767426, '749.4 KB'],
    [5 * 1024 * 1024, '5 MB'],
  ])('writes %d bytes as %s', (bytes, text) => {
    expect(formatSize(bytes)).toBe(text)
  })
})
