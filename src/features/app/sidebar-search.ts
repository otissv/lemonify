/**
 * The items whose texts contain every word of the query, ignoring case. A
 * blank query keeps everything. The order of the items is kept.
 */
export function filterByQuery<T>(
  items: ReadonlyArray<T>,
  query: string,
  textsOf: (item: T) => ReadonlyArray<string>,
): Array<T> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...items]
  const kept: Array<T> = []
  for (const item of items) {
    const haystack = textsOf(item).join('\n').toLowerCase()
    if (words.every((word) => haystack.includes(word))) kept.push(item)
  }
  return kept
}
