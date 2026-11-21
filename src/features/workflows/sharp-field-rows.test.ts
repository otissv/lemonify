import { describe, expect, it } from 'vitest'

import { sharpFieldRows } from '@/features/workflows/sharp-field-rows'
import { sharpOpFields } from '@/features/workflows/sharp-op-fields'

function names(op: string): string[][] {
  return sharpFieldRows(op, sharpOpFields(op)).map((row) =>
    row.map(({ name }) => name),
  )
}

describe('sharpFieldRows', () => {
  it('puts width and height in one row, where width was', () => {
    const rows = names('resize')
    expect(rows[0]).toEqual(['width', 'height'])
    expect(rows.flat()).toEqual(sharpOpFields('resize').map(({ name }) => name))
  })

  it('pairs them wherever they come in the list', () => {
    const rows = names('extract')
    expect(rows).toContainEqual(['width', 'height'])
    expect(rows.flat()).toEqual(
      sharpOpFields('extract').map(({ name }) => name),
    )
  })

  it('puts the sides of an extend two to a row, top with bottom and left with right', () => {
    const rows = names('extend')
    expect(rows.slice(0, 2)).toEqual([
      ['top', 'bottom'],
      ['left', 'right'],
    ])
  })

  it('puts the input and output offsets of an affine two to a row, x with y', () => {
    const rows = names('affine')
    expect(rows).toContainEqual(['idx', 'idy'])
    expect(rows).toContainEqual(['odx', 'ody'])
  })

  it('pairs sides only for the op that names them, so other ops keep their own layout', () => {
    expect(names('extract')).toContainEqual(['left'])
    expect(names('extract')).toContainEqual(['top'])
  })

  it('gives every other field a row of its own', () => {
    for (const row of names('resize')) {
      if (row.includes('width')) continue
      expect(row).toHaveLength(1)
    }
  })

  it('leaves a width with no height on its own', () => {
    const fields = sharpOpFields('resize').filter(
      ({ name }) => name !== 'height',
    )
    const rows = sharpFieldRows('resize', fields)
    expect(rows.every((row) => row.length === 1)).toBe(true)
  })
})
