import { describe, expect, it } from 'vitest'

import { itemIdFromPath } from '@/features/realtime/use-realtime'

describe('itemIdFromPath', () => {
  it('reads the id of the document or workflow a path shows', () => {
    expect(itemIdFromPath('/documents/abc-123')).toBe('abc-123')
    expect(itemIdFromPath('/documents/abc-123/')).toBe('abc-123')
    expect(itemIdFromPath('/workflows/w-1')).toBe('w-1')
  })

  it('is undefined for every other page', () => {
    expect(itemIdFromPath('/')).toBeUndefined()
    expect(itemIdFromPath('/documents')).toBeUndefined()
    expect(itemIdFromPath('/workflows')).toBeUndefined()
  })
})
