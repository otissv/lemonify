import { describe, expect, it } from 'vitest'

import { filterByQuery } from '@/features/app/sidebar-search'

const ITEMS = [
  { name: 'Holiday', file: 'beach.PNG' },
  { name: 'Portrait', file: 'me.jpg' },
  { name: 'Logo', file: 'brand.svg' },
]

function texts(item: (typeof ITEMS)[number]): ReadonlyArray<string> {
  return [item.name, item.file]
}

describe('filterByQuery', () => {
  it('keeps everything for an empty or blank query', () => {
    expect(filterByQuery(ITEMS, '', texts)).toEqual(ITEMS)
    expect(filterByQuery(ITEMS, '   ', texts)).toEqual(ITEMS)
  })

  it('matches any of the texts, ignoring case', () => {
    expect(filterByQuery(ITEMS, 'HOLI', texts)).toEqual([ITEMS[0]])
    expect(filterByQuery(ITEMS, 'png', texts)).toEqual([ITEMS[0]])
  })

  it('needs every word of the query to match somewhere', () => {
    expect(filterByQuery(ITEMS, 'port jpg', texts)).toEqual([ITEMS[1]])
    expect(filterByQuery(ITEMS, 'port png', texts)).toEqual([])
  })

  it('keeps the original order', () => {
    expect(filterByQuery(ITEMS, 'o', texts)).toEqual(ITEMS)
  })
})
