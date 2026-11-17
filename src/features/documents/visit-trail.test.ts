import { describe, expect, it } from 'vitest'

import {
  closeInTrail,
  lastVisitOfKind,
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

  it('keeps the same trail when the page is already last', () => {
    const trail = ['a', 'b', 'c']
    expect(visitInTrail(trail, 'c')).toBe(trail)
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

describe('lastVisitOfKind', () => {
  const items = [
    { id: 'd1', kind: 'document' as const },
    { id: 'w1', kind: 'workflow' as const },
    { id: 'd2', kind: 'document' as const },
  ]

  it('is the most recent trail entry of the requested kind', () => {
    expect(lastVisitOfKind(['d1', 'w1', 'd2'], 'document', items)).toEqual({
      id: 'd2',
      kind: 'document',
    })
    expect(lastVisitOfKind(['d1', 'w1', 'd2'], 'workflow', items)).toEqual({
      id: 'w1',
      kind: 'workflow',
    })
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
