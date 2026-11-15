import { z } from 'zod'

export type Matrix = Array<Array<number>>

export interface Dimensions {
  width: number
  height: number
}

const NumberListSchema = z.array(z.number())
const NestedSchema = z.array(NumberListSchema)

export function identityMatrix(size: number): Matrix {
  return Array.from({ length: size }, (_row, y) =>
    Array.from({ length: size }, (_cell, x) => (x === y ? 1 : 0)),
  )
}

/**
 * The value as `rows` × `cols` numbers, from nested rows or a flat list read
 * row by row; undefined when it is not that shape.
 */
export function readMatrix(
  value: unknown,
  rows: number,
  cols: number,
): Matrix | undefined {
  const nested = NestedSchema.safeParse(value)
  if (nested.success) {
    const fits =
      nested.data.length === rows &&
      nested.data.every((row) => row.length === cols)
    return fits ? nested.data : undefined
  }
  const flat = NumberListSchema.safeParse(value)
  if (!flat.success || flat.data.length !== rows * cols) return undefined
  const matrix: Matrix = []
  for (let y = 0; y < rows; y += 1)
    matrix.push(flat.data.slice(y * cols, (y + 1) * cols))
  return matrix
}

/** The matrix as Sharp takes it: nested rows, or one flat list. */
export function writeMatrix(
  matrix: Matrix,
  layout: 'nested' | 'flat',
): Matrix | Array<number> {
  return layout === 'nested' ? matrix : matrix.flat()
}

/** A flat kernel moved to new dimensions: values that still fit stay where they were, new places are zero. */
export function resizeKernel(
  kernel: ReadonlyArray<number>,
  from: Dimensions,
  to: Dimensions,
): Array<number> {
  const resized: Array<number> = []
  for (let y = 0; y < to.height; y += 1) {
    for (let x = 0; x < to.width; x += 1) {
      const inside = x < from.width && y < from.height
      resized.push(inside ? (kernel.at(y * from.width + x) ?? 0) : 0)
    }
  }
  return resized
}
