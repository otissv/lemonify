import { describe, expect, it } from 'vitest'

import {
  identityMatrix,
  readMatrix,
  resizeKernel,
  writeMatrix,
} from '@/features/workflows/fields/matrix-value'

describe('identityMatrix', () => {
  it('has ones on the diagonal', () => {
    expect(identityMatrix(3)).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ])
  })
})

describe('readMatrix', () => {
  it('reads nested rows', () => {
    expect(
      readMatrix(
        [
          [1, 2],
          [3, 4],
        ],
        2,
        2,
      ),
    ).toEqual([
      [1, 2],
      [3, 4],
    ])
  })

  it('reads a flat list row by row', () => {
    expect(readMatrix([1, 2, 3, 4], 2, 2)).toEqual([
      [1, 2],
      [3, 4],
    ])
  })

  it('is undefined when the value is not the shape asked for', () => {
    expect(readMatrix([1, 2, 3], 2, 2)).toBeUndefined()
    expect(readMatrix('x', 2, 2)).toBeUndefined()
    expect(readMatrix(undefined, 2, 2)).toBeUndefined()
    expect(readMatrix([[1, 2], [3]], 2, 2)).toBeUndefined()
  })
})

describe('writeMatrix', () => {
  it('writes nested rows, or a flat list', () => {
    const rows = [
      [1, 2],
      [3, 4],
    ]

    expect(writeMatrix(rows, 'nested')).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(writeMatrix(rows, 'flat')).toEqual([1, 2, 3, 4])
  })
})

describe('resizeKernel', () => {
  it('keeps the values that still fit and fills new places with zero', () => {
    const kernel = [1, 2, 3, 4, 5, 6, 7, 8, 9]

    expect(
      resizeKernel(kernel, { width: 3, height: 3 }, { width: 2, height: 2 }),
    ).toEqual([1, 2, 4, 5])
    expect(
      resizeKernel(
        [1, 2, 3, 4],
        { width: 2, height: 2 },
        { width: 3, height: 2 },
      ),
    ).toEqual([1, 2, 0, 3, 4, 0])
  })
})
