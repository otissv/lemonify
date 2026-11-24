/** Which of two linked values changed. */
export enum PairSide {
  First = 'first',
  Second = 'second',
}

/** The smallest whole value a side can follow down to, so a size never reaches zero. */
const SMALLEST_WHOLE_SIDE = 1

/** Whether a value can be one side of a kept proportion: a positive number. */
export function isProportionSide(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** The second value over the first, or undefined unless both are positive numbers. */
export function proportionOf(
  first: unknown,
  second: unknown,
): number | undefined {
  if (!isProportionSide(first) || !isProportionSide(second)) return undefined
  return second / first
}

/** The other value of a pair kept at `proportion` (second over first) when `changed` becomes `value`. */
export function partnerOf(
  changed: PairSide,
  value: number,
  proportion: number,
  { integers }: { integers: boolean },
): number {
  const exact =
    changed === PairSide.First ? value * proportion : value / proportion
  if (!integers) return exact
  return Math.max(SMALLEST_WHOLE_SIDE, Math.round(exact))
}
