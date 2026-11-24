import { useState } from 'react'

import {
  PairSide,
  isProportionSide,
  partnerOf,
  proportionOf,
} from '@/lib/kept-proportion'

type Pair<Value> = readonly [
  Value | number | undefined,
  Value | number | undefined,
]

/** The proportion being kept, and the pair it was last taken from or written as. */
interface Tracked<Value> {
  proportion: number | undefined
  first: Pair<Value>[0]
  second: Pair<Value>[1]
}

export interface KeptProportion<Value> {
  locked: boolean
  setLocked: (locked: boolean) => void
  /** The pair after one side becomes `value`: while locked, and once a proportion is known, the other side follows it. */
  change: (side: PairSide, value: Value | undefined) => Pair<Value>
}

interface KeptProportionOptions {
  /** Round the side that follows to a whole number. */
  integers: boolean
  initiallyLocked?: boolean
}

/**
 * Keeps two values, such as a width and a height, in the proportion they had
 * when they were linked. The proportion is taken when the values first arrive,
 * when the lock is switched on, and whenever the values change from outside
 * (undo, a reset), never from what is typed into them: a number typed digit by
 * digit neither wears the proportion down through rounding nor sets it from
 * its first digit.
 */
export function useKeptProportion<Value>(
  first: Value | undefined,
  second: Value | undefined,
  { integers, initiallyLocked = true }: KeptProportionOptions,
): KeptProportion<Value> {
  const [locked, setLockedState] = useState(initiallyLocked)
  const [tracked, setTracked] = useState<Tracked<Value>>(() => ({
    proportion: proportionOf(first, second),
    first,
    second,
  }))
  if (!Object.is(tracked.first, first) || !Object.is(tracked.second, second)) {
    const proportion = proportionOf(first, second) ?? tracked.proportion
    setTracked({ proportion, first, second })
  }

  function setLocked(next: boolean): void {
    if (next) {
      const proportion = proportionOf(first, second) ?? tracked.proportion
      setTracked({ proportion, first, second })
    }
    setLockedState(next)
  }

  function followed(side: PairSide, value: Value | undefined): Pair<Value> {
    const { proportion } = tracked
    if (!locked || proportion === undefined || !isProportionSide(value)) {
      return side === PairSide.First ? [value, second] : [first, value]
    }
    const partner = partnerOf(side, value, proportion, { integers })
    return side === PairSide.First ? [value, partner] : [partner, value]
  }

  function change(side: PairSide, value: Value | undefined): Pair<Value> {
    const pair = followed(side, value)
    setTracked({
      proportion: tracked.proportion,
      first: pair[0],
      second: pair[1],
    })
    return pair
  }

  return { locked, setLocked, change }
}
