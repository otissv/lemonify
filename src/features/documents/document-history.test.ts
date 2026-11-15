import { describe, expect, it } from 'vitest'

import {
  closeInHistory,
  previousDocumentId,
  visitInHistory,
} from '@/features/documents/document-history'

describe('visitInHistory', () => {
  it('puts the visited document last', () => {
    expect(visitInHistory(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
  })

  it('moves a document already in the history to the end, once', () => {
    expect(visitInHistory(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a'])
  })
})

describe('closeInHistory', () => {
  it('takes the document out', () => {
    expect(closeInHistory(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })

  it('leaves the history alone when the document is not in it', () => {
    expect(closeInHistory(['a'], 'z')).toEqual(['a'])
  })
})

describe('previousDocumentId', () => {
  it('is the document opened just before the one being closed', () => {
    expect(previousDocumentId(['a', 'b', 'c'], 'c', ['a', 'b', 'c'])).toBe('b')
  })

  it('skips documents that no longer exist', () => {
    expect(previousDocumentId(['a', 'b', 'c'], 'c', ['a', 'c'])).toBe('a')
  })

  it('is undefined when nothing else was open', () => {
    expect(previousDocumentId(['c'], 'c', ['c'])).toBeUndefined()
    expect(previousDocumentId([], 'c', [])).toBeUndefined()
  })

  it('never returns the document being closed', () => {
    expect(previousDocumentId(['c', 'c'], 'c', ['c'])).toBeUndefined()
  })
})
