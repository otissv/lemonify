import { describe, expect, it } from 'vitest'

import { errorMessage } from '@/lib/error-message'

describe('errorMessage', () => {
  it('uses the message of an error', () => {
    expect(errorMessage(new Error('Disk full'), 'Failed')).toBe('Disk full')
  })

  it('falls back when the error has no message', () => {
    expect(errorMessage(new Error(''), 'Failed')).toBe('Failed')
  })

  it('falls back for anything that is not an error', () => {
    expect(errorMessage('boom', 'Failed')).toBe('Failed')
  })
})
