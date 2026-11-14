// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { SHARP_OP_NAMES, sharpOpSchema } from './ops.ts'

describe('sharpOpSchema', () => {
  it.each([
    { op: 'resize', width: 300, fit: 'cover', position: 'attention' },
    { op: 'rotate', angle: 90, background: '#ffffff' },
    { op: 'extract', left: 0, top: 0, width: 10, height: 10 },
    { op: 'affine', matrix: [1, 0.2, 0, 1], interpolator: 'nohalo' },
    { op: 'blur', sigma: 2 },
    { op: 'modulate', brightness: 1.2, hue: 90 },
    {
      op: 'convolve',
      width: 3,
      height: 3,
      kernel: [0, 0, 0, 0, 1, 0, 0, 0, 0],
    },
    {
      op: 'recomb',
      matrix: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    },
    { op: 'tint', colour: { r: 255, g: 0, b: 0 } },
    { op: 'grayscale' },
    { op: 'extractChannel', channel: 'green' },
    {
      op: 'composite',
      images: [{ input: 'logo.png', gravity: 'southeast', blend: 'over' }],
    },
    { op: 'withMetadata', orientation: 1 },
    { op: 'webp', quality: 80, lossless: false, loop: 0 },
    { op: 'toFormat', format: 'jpeg', options: { quality: 70 } },
    { op: 'tile', size: 512, layout: 'dz' },
    { op: 'timeout', seconds: 10 },
  ])('accepts $op', (op) => {
    expect(sharpOpSchema.safeParse(op).success).toBe(true)
  })

  it.each<[unknown, string]>([
    [{ op: 'explode' }, 'unknown op'],
    [{ op: 'resize', fit: 'squash' }, 'unknown enum value'],
    [{ op: 'resize', widht: 300 }, 'misspelled key'],
    [{ op: 'webp', quality: 101 }, 'out-of-range quality'],
    [{ op: 'extract', left: 0, top: 0, width: 10 }, 'missing height'],
    [{ op: 'convolve', width: 3, height: 3, kernel: [1, 2] }, 'short kernel'],
    [{ op: 'sharpen', m1: 1 }, 'sharpen options without sigma'],
    [
      { op: 'toFormat', format: 'png', options: { lossless: true } },
      'options of another format',
    ],
  ])('rejects %j (%s)', (op) => {
    expect(sharpOpSchema.safeParse(op).success).toBe(false)
  })

  it('exports a JSON Schema that lists every op', () => {
    const schema = JSON.stringify(
      z.toJSONSchema(sharpOpSchema, { io: 'input', unrepresentable: 'any' }),
    )
    for (const name of SHARP_OP_NAMES) expect(schema).toContain(`"${name}"`)
  })

  it('covers every chainable Sharp operation', () => {
    expect([...SHARP_OP_NAMES].sort()).toEqual(
      [
        'affine',
        'autoOrient',
        'avif',
        'bandbool',
        'blur',
        'boolean',
        'clahe',
        'composite',
        'convolve',
        'dilate',
        'ensureAlpha',
        'erode',
        'extend',
        'extract',
        'extractChannel',
        'flatten',
        'flip',
        'flop',
        'gamma',
        'gif',
        'grayscale',
        'greyscale',
        'heif',
        'joinChannel',
        'jp2',
        'jpeg',
        'jxl',
        'keepExif',
        'keepIccProfile',
        'keepMetadata',
        'keepXmp',
        'linear',
        'median',
        'modulate',
        'negate',
        'normalise',
        'normalize',
        'pipelineColorspace',
        'pipelineColourspace',
        'png',
        'raw',
        'recomb',
        'removeAlpha',
        'resize',
        'rotate',
        'sharpen',
        'threshold',
        'tiff',
        'tile',
        'timeout',
        'tint',
        'toColorspace',
        'toColourspace',
        'toFormat',
        'trim',
        'unflatten',
        'webp',
        'withDensity',
        'withExif',
        'withExifMerge',
        'withIccProfile',
        'withMetadata',
        'withXmp',
      ].sort(),
    )
  })
})
