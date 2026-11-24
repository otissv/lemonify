import { describe, expect, it } from 'vitest'

import {
  startingSharpOptions,
  startsAtPictureSize,
} from '@/features/pipeline/sharp-starting-options'
import {
  SHARP_OP_GROUPS,
  missingSharpOptions,
  sharpOptionProblems,
} from '@/features/workflows/sharp-op-fields'

const ALL_OPS = SHARP_OP_GROUPS.flatMap(({ ops }) => ops)

describe('startingSharpOptions', () => {
  it('starts a scale or opacity step at 100%, which leaves the picture as it was', () => {
    expect(startingSharpOptions('scale')).toEqual({ percent: 100 })
    expect(startingSharpOptions('opacity')).toEqual({ percent: 100 })
  })

  it('starts matrices as the identity, so the step changes nothing until edited', () => {
    expect(startingSharpOptions('affine')).toEqual({
      matrix: [
        [1, 0],
        [0, 1],
      ],
    })
    expect(startingSharpOptions('convolve')).toEqual({
      width: 3,
      height: 3,
      kernel: [0, 0, 0, 0, 1, 0, 0, 0, 0],
    })
  })

  it('gives nothing to an op that needs nothing', () => {
    expect(startingSharpOptions('blur')).toEqual({})
  })

  it('starts a tint red', () => {
    expect(startingSharpOptions('tint')).toEqual({ colour: '#ff0000' })
  })

  it('only starts options with values the op accepts', () => {
    for (const op of ALL_OPS) {
      expect(
        sharpOptionProblems(
          op,
          startingSharpOptions(op, {
            imageId: 'src-1',
            size: { width: 640, height: 480 },
          }),
        ),
        op,
      ).toEqual({})
    }
  })

  it('leaves no op needing anything, but extract, whose region the canvas sets', () => {
    for (const op of ALL_OPS) {
      const missing = missingSharpOptions(
        op,
        startingSharpOptions(op, { imageId: 'src-1' }),
      )
      if (op === 'extract') continue
      expect(missing, op).toEqual([])
    }
  })

  it('uses the image it is given as the other image of a step that needs one', () => {
    const context = { imageId: 'src-1' }
    expect(startingSharpOptions('boolean', context)).toEqual({
      operator: 'and',
      operand: 'src-1',
    })
    expect(startingSharpOptions('joinChannel', context)).toEqual({
      images: ['src-1'],
    })
    expect(startingSharpOptions('composite', context)).toEqual({
      images: [{ input: 'src-1' }],
    })
  })

  it('leaves the other image to be chosen when there is none to give', () => {
    expect(
      missingSharpOptions('boolean', startingSharpOptions('boolean')),
    ).toEqual(['operand'])
  })

  it('starts a resize at the size of the picture it acts on', () => {
    expect(
      startingSharpOptions('resize', { size: { width: 800, height: 600 } }),
    ).toEqual({ width: 800, height: 600 })
  })

  it('leaves a resize empty when the size of its picture is not known', () => {
    expect(startingSharpOptions('resize')).toEqual({})
  })

  it('says which ops start at the size of their picture', () => {
    expect(startsAtPictureSize('resize')).toBe(true)
    expect(startsAtPictureSize('scale')).toBe(false)
  })

  it('hands out a fresh copy each time', () => {
    const first = startingSharpOptions('recomb')
    const matrix = first.matrix
    if (!Array.isArray(matrix)) throw new Error('no matrix')
    matrix.length = 0
    expect(startingSharpOptions('recomb').matrix).toHaveLength(3)
  })
})
