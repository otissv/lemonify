import { describe, expect, it } from 'vitest'

import { uniqueName } from '@/lib/unique-name'

describe('uniqueName', () => {
  it('is the name itself when no other has it, ignoring case and spaces', () => {
    expect(uniqueName(' Poster ', [{ name: 'Other' }], 80)).toBe('Poster')
  })

  it('numbers it from 2 when it is taken', () => {
    const taken = [{ name: 'poster' }, { name: 'Poster 2' }]
    expect(uniqueName('Poster', taken, 80)).toBe('Poster 3')
  })

  it('stays within the longest name allowed, cutting the name and not the number', () => {
    expect(uniqueName('abcdef', [], 4)).toBe('abcd')
    expect(uniqueName('abcd', [{ name: 'abcd' }], 4)).toBe('ab 2')
  })
})
