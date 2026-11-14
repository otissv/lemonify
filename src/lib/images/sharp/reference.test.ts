// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { sharpInputOptionsSchema } from './input-options.ts'
import { sharpSettingsSchema } from './job-schema.ts'
import { SHARP_OP_NAMES } from './ops.ts'
import { OUTPUT_FORMATS } from './output-options.ts'
import { renderSharpReference } from './reference.ts'
import { describeType } from './reference-types.ts'

describe('describeType', () => {
  it.each<[z.ZodType, string]>([
    [z.enum(['a', 'b']), '`"a"` \\| `"b"`'],
    [z.literal(90), '`90`'],
    [z.number().int().nonnegative(), 'integer ≥ 0'],
    [z.number().int().positive(), 'integer > 0'],
    [z.number().min(0).max(1), 'number 0–1'],
    [z.boolean(), 'boolean'],
    [z.string(), 'string'],
    [z.array(z.number()), 'number[]'],
    [
      z.union([z.boolean(), z.number().int().positive()]),
      'boolean or integer > 0',
    ],
    [z.array(z.union([z.string(), z.number()])), '(string or number)[]'],
    [z.strictObject({ r: z.number(), g: z.number() }), 'object { r, g }'],
  ])('describes %#', (schema, expected) => {
    const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })
    expect(describeType(json)).toBe(expected)
  })
})

describe('renderSharpReference', () => {
  const reference = renderSharpReference()

  it('documents every op under its own heading', () => {
    for (const name of SHARP_OP_NAMES)
      expect(reference).toContain(`### \`${name}\``)
  })

  it('documents every input option and setting', () => {
    for (const key of Object.keys(sharpInputOptionsSchema.shape))
      expect(reference).toContain(`| \`${key}\``)
    for (const key of Object.keys(sharpSettingsSchema.shape))
      expect(reference).toContain(`| \`${key}\``)
  })

  it('documents the encoder options of every format', () => {
    for (const format of OUTPUT_FORMATS)
      expect(reference).toContain(`### \`${format}\` options`)
  })

  it('flattens nested objects into dotted field names', () => {
    expect(reference).toContain('| `create.background`')
    expect(reference).toContain('| `images[].gravity`')
  })
})
