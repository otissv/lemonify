import { describe, expect, it } from 'vitest'

import { placeAt } from '@/lib/place-at'

describe('placeAt', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('moves an id to a place in the list', () => {
    expect(placeAt(ids, 'd', 1)).toEqual(['a', 'd', 'b', 'c'])
    expect(placeAt(ids, 'a', 2)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('holds a place beyond the ends to the ends', () => {
    expect(placeAt(ids, 'b', 99)).toEqual(['a', 'c', 'd', 'b'])
    expect(placeAt(ids, 'c', -3)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('leaves the list as it was when the id is already there', () => {
    expect(placeAt(ids, 'b', 1)).toEqual(ids)
  })

  it('does not change the list it is given', () => {
    placeAt(ids, 'd', 0)
    expect(ids).toEqual(['a', 'b', 'c', 'd'])
  })
})
