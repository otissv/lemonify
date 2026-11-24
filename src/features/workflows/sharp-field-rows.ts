import { OpFieldKind } from '@/features/workflows/sharp-op-fields'
import type { OpField } from '@/features/workflows/sharp-op-fields'

type FieldPair = readonly [string, string]

/** Options read as one measurement in any op, shown side by side, in this order. */
const FIELD_PAIRS: ReadonlyArray<FieldPair> = [['width', 'height']]

/** Pairs only one op has, such as the four sides an extend adds to. Adding a pair is one entry. */
const OP_FIELD_PAIRS: Readonly<Record<string, ReadonlyArray<FieldPair>>> = {
  extend: [
    ['top', 'bottom'],
    ['left', 'right'],
  ],
  affine: [
    ['idx', 'idy'],
    ['odx', 'ody'],
  ],
}

/** Pairs that make the size of a picture in an op, whose proportion a chain between them keeps. Adding one is one entry. */
const SIZE_PAIRS: Readonly<Record<string, ReadonlyArray<FieldPair>>> = {
  resize: [['width', 'height']],
}

const NUMBER_KINDS: ReadonlySet<OpFieldKind> = new Set([
  OpFieldKind.Integer,
  OpFieldKind.Number,
])

/** Whether a row of this op is the size of a picture, two numbers whose proportion can be kept, such as a resize's width and height. */
export function isSizeRow(op: string, row: ReadonlyArray<OpField>): boolean {
  const [first, second] = row
  if (row.length !== 2 || first === undefined || second === undefined) {
    return false
  }
  const named = (SIZE_PAIRS[op] ?? []).some(
    ([one, other]) => first.name === one && second.name === other,
  )
  return named && NUMBER_KINDS.has(first.kind) && NUMBER_KINDS.has(second.kind)
}

function pairOf(op: string, name: string): FieldPair | undefined {
  const pairs = [...(OP_FIELD_PAIRS[op] ?? []), ...FIELD_PAIRS]
  return pairs.find((pair) => pair.includes(name))
}

/**
 * The fields of a Sharp op laid out in rows: a pair such as width and height
 * shares one row, at the place the first of them comes, and every other field
 * has a row of its own. A field whose partner the op does not have stays alone.
 */
export function sharpFieldRows(
  op: string,
  fields: ReadonlyArray<OpField>,
): Array<ReadonlyArray<OpField>> {
  const byName = new Map(fields.map((field) => [field.name, field]))
  const placed = new Set<string>()
  const rows: Array<ReadonlyArray<OpField>> = []
  for (const field of fields) {
    if (placed.has(field.name)) continue
    const pair = pairOf(op, field.name)
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
