import { describe, expect, it } from 'vitest'

import {
  closeInTrail,
  previousVisit,
  visitInTrail,
} from '@/features/documents/visit-trail'

describe('visitInTrail', () => {
  it('puts the visited page last', () => {
    expect(visitInTrail(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
  })

  it('moves a page already in the trail to the end, once', () => {
    expect(visitInTrail(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a'])
  })
})

describe('closeInTrail', () => {
  it('takes the page out', () => {
    expect(closeInTrail(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })

  it('leaves the trail alone when the page is not in it', () => {
    expect(closeInTrail(['a'], 'z')).toEqual(['a'])
  })
})

describe('previousVisit', () => {
  const documents = (...ids: string[]) =>
    ids.map((id) => ({ id, kind: 'document' as const }))

  it('is the page opened just before the one being closed', () => {
    expect(
      previousVisit(['a', 'b', 'c'], 'c', documents('a', 'b', 'c')),
    ).toEqual({ id: 'b', kind: 'document' })
  })

  it('can be a workflow, and says so', () => {
    expect(
      previousVisit(['w', 'c'], 'c', [
        { id: 'w', kind: 'workflow' },
        { id: 'c', kind: 'document' },
      ]),
    ).toEqual({ id: 'w', kind: 'workflow' })
  })

  it('skips pages that no longer exist', () => {
    expect(previousVisit(['a', 'b', 'c'], 'c', documents('a', 'c'))).toEqual({
      id: 'a',
      kind: 'document',
    })
  })

  it('is undefined when nothing else was open', () => {
    expect(previousVisit(['c'], 'c', documents('c'))).toBeUndefined()
    expect(previousVisit([], 'c', [])).toBeUndefined()
  })

  it('never returns the page being closed', () => {
    expect(previousVisit(['c', 'c'], 'c', documents('c'))).toBeUndefined()
  })
})
