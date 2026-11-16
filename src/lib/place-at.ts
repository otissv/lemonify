/** The ids with `id` moved to `index`, which is held to the ends of the list. */
export function placeAt(
  ids: ReadonlyArray<string>,
  id: string,
  index: number,
): string[] {
  const others = ids.filter((other) => other !== id)
  const place = Math.min(Math.max(index, 0), others.length)
  return [...others.slice(0, place), id, ...others.slice(place)]
}
