import { describe, expect, it } from 'vitest'

import { pickSteps } from '@/features/documents/step-selection'

const SIBLINGS = ['a', 'b', 'c', 'd', 'e']
const PLAIN = { toggle: false, range: false }

describe('pickSteps', () => {
  it('picks only the clicked step', () => {
    expect(
      pickSteps({
        siblings: SIBLINGS,
        marked: ['a', 'b'],
        anchor: 'a',
        clicked: 'd',
        modifiers: PLAIN,
      }),
    ).toEqual(['d'])
  })

  it('adds a step and takes it out again when toggled', () => {
    const added = pickSteps({
      siblings: SIBLINGS,
      marked: ['a'],
      anchor: 'a',
      clicked: 'c',
      modifiers: { toggle: true, range: false },
    })
    expect(added).toEqual(['a', 'c'])
    const removed = pickSteps({
      siblings: SIBLINGS,
      marked: added,
      anchor: 'c',
      clicked: 'a',
      modifiers: { toggle: true, range: false },
    })
    expect(removed).toEqual(['c'])
  })

  it('picks the run between the selected step and the clicked one, in either direction', () => {
    const range = { toggle: false, range: true }
    expect(
      pickSteps({
        siblings: SIBLINGS,
        marked: ['b'],
        anchor: 'b',
        clicked: 'd',
        modifiers: range,
      }),
    ).toEqual(['b', 'c', 'd'])
    expect(
      pickSteps({
        siblings: SIBLINGS,
        marked: ['d'],
        anchor: 'd',
        clicked: 'b',
        modifiers: range,
      }),
    ).toEqual(['b', 'c', 'd'])
  })

  it('picks only the clicked step when the selected one is somewhere else', () => {
    expect(
      pickSteps({
        siblings: ['x', 'y'],
        marked: ['b'],
        anchor: 'b',
        clicked: 'y',
        modifiers: { toggle: false, range: true },
      }),
    ).toEqual(['y'])
  })

  it('drops picked steps that are not among the clicked step’s siblings when toggling', () => {
    expect(
      pickSteps({
        siblings: ['x', 'y'],
        marked: ['a', 'b'],
        anchor: 'a',
        clicked: 'y',
        modifiers: { toggle: true, range: false },
      }),
    ).toEqual(['y'])
  })
})
