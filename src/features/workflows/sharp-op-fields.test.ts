import { describe, expect, it } from 'vitest'

import {
  OpFieldKind,
  SHARP_OP_GROUPS,
  opLabel,
  sharpOpFields,
  missingSharpOptions,
  sharpOptionProblems,
} from '@/features/workflows/sharp-op-fields'
import { SHARP_OP_NAMES } from '@/lib/images/sharp/ops'

describe('SHARP_OP_GROUPS', () => {
  it('lists every Sharp op exactly once', () => {
    const grouped = SHARP_OP_GROUPS.flatMap(({ ops }) => ops)

    expect([...grouped].sort()).toEqual([...SHARP_OP_NAMES].sort())
  })
})

describe('opLabel', () => {
  it.each([
    ['resize', 'Resize'],
    ['autoOrient', 'Auto orient'],
    ['toColourspace', 'To colourspace'],
  ])('labels %s as %s', (op, label) => {
    expect(opLabel(op)).toBe(label)
  })
})

describe('sharpOpFields', () => {
  it('describes every option of an op except the op name', () => {
    const fields = sharpOpFields('resize')

    expect(fields.map(({ name }) => name)).not.toContain('op')
    expect(fields.find(({ name }) => name === 'width')).toMatchObject({
      kind: OpFieldKind.Integer,
      label: 'Width',
      min: 1,
    })
    expect(fields.find(({ name }) => name === 'fit')).toMatchObject({
      kind: OpFieldKind.Enum,
      choices: ['contain', 'cover', 'fill', 'inside', 'outside'],
    })
    expect(
      fields.find(({ name }) => name === 'withoutEnlargement'),
    ).toMatchObject({ kind: OpFieldKind.Boolean, label: 'Without enlargement' })
  })

  it('keeps number limits', () => {
    expect(
      sharpOpFields('jpeg').find(({ name }) => name === 'quality'),
    ).toMatchObject({ kind: OpFieldKind.Integer, min: 1, max: 100 })
  })

  it('edits colours with the colour picker, keeping their description', () => {
    expect(
      sharpOpFields('resize').find(({ name }) => name === 'background'),
    ).toMatchObject({
      kind: OpFieldKind.Colour,
      description: expect.stringContaining('CSS colour'),
    })
    expect(
      sharpOpFields('tint').find(({ name }) => name === 'colour'),
    ).toMatchObject({ kind: OpFieldKind.Colour, required: true })
  })

  it('edits matrices in a grid', () => {
    const matrix = (op: string, name: string): unknown =>
      sharpOpFields(op).find((field) => field.name === name)

    expect(matrix('affine', 'matrix')).toMatchObject({
      kind: OpFieldKind.Matrix,
      matrix: { kind: 'fixed', size: 2 },
    })
    expect(matrix('recomb', 'matrix')).toMatchObject({
      kind: OpFieldKind.Matrix,
      matrix: { kind: 'choice', sizes: [3, 4] },
    })
    expect(matrix('convolve', 'kernel')).toMatchObject({
      kind: OpFieldKind.Matrix,
      matrix: { kind: 'kernel' },
    })
  })

  it('chooses other images with the image chooser', () => {
    const kind = (op: string, name: string): unknown =>
      sharpOpFields(op).find((field) => field.name === name)?.kind

    expect(kind('boolean', 'operand')).toBe(OpFieldKind.Image)
    expect(kind('joinChannel', 'images')).toBe(OpFieldKind.Images)
    expect(kind('composite', 'images')).toBe(OpFieldKind.Layers)
  })

  it('marks required options', () => {
    const images = sharpOpFields('composite').find(
      ({ name }) => name === 'images',
    )

    expect(images).toMatchObject({ required: true })
  })
})

describe('sharpOptionProblems', () => {
  it('accepts valid options', () => {
    expect(sharpOptionProblems('resize', { width: 800 })).toEqual({})
    expect(sharpOptionProblems('sharpen', {})).toEqual({})
  })

  it('reports problems against the option they belong to', () => {
    const problems = sharpOptionProblems('resize', { width: 0, fit: 'squash' })

    expect(Object.keys(problems).sort()).toEqual(['fit', 'width'])
  })

  it('leaves options that are not filled in yet to missingSharpOptions', () => {
    expect(sharpOptionProblems('extract', {})).toEqual({})
    expect(sharpOptionProblems('toFormat', {})).toEqual({})
  })

  it.each(SHARP_OP_NAMES)('shows no problems on a new %s step', (op) => {
    expect(sharpOptionProblems(op, {})).toEqual({})
  })

  it('explains a number that is too small in plain words', () => {
    expect(sharpOptionProblems('resize', { width: 0 })).toEqual({
      width: 'Must be greater than 0.',
    })
    expect(sharpOptionProblems('resize', { width: 1.5 })).toEqual({
      width: 'Must be a whole number.',
    })
  })

  it('explains a choice that is not offered', () => {
    expect(sharpOptionProblems('resize', { fit: 'squash' })).toEqual({
      fit: 'Choose one of the listed options.',
    })
  })

  it('never shows the schema library’s raw messages', () => {
    const problems = {
      ...sharpOptionProblems('affine', { matrix: 'x' }),
      ...sharpOptionProblems('composite', { images: 'x' }),
      ...sharpOptionProblems('withExif', { exif: 3 }),
    }

    expect(Object.keys(problems).length).toBeGreaterThan(0)
    for (const message of Object.values(problems)) {
      expect(message).not.toMatch(/invalid input|expected|received/i)
    }
  })
})

describe('missingSharpOptions', () => {
  it('lists the required options that are not filled in', () => {
    expect(missingSharpOptions('extract', { left: 0 })).toEqual([
      'top',
      'width',
      'height',
    ])
  })

  it('is empty when nothing is required', () => {
    expect(missingSharpOptions('sharpen', {})).toEqual([])
  })
})
