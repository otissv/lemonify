import { describe, expect, it } from 'vitest'

import { documentIdFromPath } from '@/features/realtime/use-realtime'

describe('documentIdFromPath', () => {
  it('reads the id of the document a path shows', () => {
    expect(documentIdFromPath('/documents/abc-123')).toBe('abc-123')
    expect(documentIdFromPath('/documents/abc-123/')).toBe('abc-123')
  })

  it('is undefined for every other page', () => {
    expect(documentIdFromPath('/')).toBeUndefined()
    expect(documentIdFromPath('/workflows/x')).toBeUndefined()
    expect(documentIdFromPath('/documents')).toBeUndefined()
  })
})
