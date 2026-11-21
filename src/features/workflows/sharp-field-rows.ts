import type { OpField } from '@/features/workflows/sharp-op-fields'

/** Options read as one measurement, shown side by side, in this order. Adding a pair is one entry. */
const FIELD_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['width', 'height'],
]

function pairOf(name: string): readonly [string, string] | undefined {
  return FIELD_PAIRS.find((pair) => pair.includes(name))
}

/**
 * The fields of a Sharp op laid out in rows: a pair such as width and height
 * shares one row, at the place the first of them comes, and every other field
 * has a row of its own. A field whose partner the op does not have stays alone.
 */
export function sharpFieldRows(
  fields: ReadonlyArray<OpField>,
): Array<ReadonlyArray<OpField>> {
  const byName = new Map(fields.map((field) => [field.name, field]))
  const placed = new Set<string>()
  const rows: Array<ReadonlyArray<OpField>> = []
  for (const field of fields) {
    if (placed.has(field.name)) continue
    const pair = pairOf(field.name)
    const first = pair ? byName.get(pair[0]) : undefined
    const second = pair ? byName.get(pair[1]) : undefined
    if (first && second) {
      rows.push([first, second])
      placed.add(first.name)
      placed.add(second.name)
      continue
    }
    rows.push([field])
    placed.add(field.name)
  }
  return rows
}
