import type { Sharp } from 'sharp'
import { z } from 'zod'

import { SharpOperationError } from './errors.ts'
import { applyColourOp, colourOpSchemas } from './ops-colour.ts'
import type { ColourOp } from './ops-colour.ts'
import { applyFilterOp, filterOpSchemas } from './ops-filter.ts'
import type { FilterOp } from './ops-filter.ts'
import { applyGeometryOp, geometryOpSchemas } from './ops-geometry.ts'
import type { GeometryOp } from './ops-geometry.ts'
import { applyOutputOp, outputOpSchemas } from './ops-output.ts'
import { FORMAT_EXTENSIONS } from './output-options.ts'

/**
 * One step of a Sharp pipeline: `{ "op": "<method>", ...arguments }`.
 * Every chainable Sharp method has an op of the same name; positional
 * arguments become named fields and option objects are flattened in.
 */
export const sharpOpSchema = z.discriminatedUnion('op', [
  ...geometryOpSchemas,
  ...filterOpSchemas,
  ...colourOpSchemas,
  ...outputOpSchemas,
])
export type SharpOp = z.infer<typeof sharpOpSchema>

function namesOf(
  schemas: readonly { shape: { op: { value: string } } }[],
): Set<string> {
  const names = new Set<string>()
  for (const schema of schemas) names.add(schema.shape.op.value)
  return names
}

const GEOMETRY_OPS = namesOf(geometryOpSchemas)
const FILTER_OPS = namesOf(filterOpSchemas)
const COLOUR_OPS = namesOf(colourOpSchemas)

export const SHARP_OP_NAMES: readonly string[] = [
  ...GEOMETRY_OPS,
  ...FILTER_OPS,
  ...COLOUR_OPS,
  ...namesOf(outputOpSchemas),
]

function isGeometryOp(step: SharpOp): step is GeometryOp {
  return GEOMETRY_OPS.has(step.op)
}

function isFilterOp(step: SharpOp): step is FilterOp {
  return FILTER_OPS.has(step.op)
}

function isColourOp(step: SharpOp): step is ColourOp {
  return COLOUR_OPS.has(step.op)
}

/** Calls the Sharp method an op names and returns the pipeline for chaining. */
export function applySharpOp(image: Sharp, step: SharpOp): Sharp {
  if (isGeometryOp(step)) return applyGeometryOp(image, step)
  if (isFilterOp(step)) return applyFilterOp(image, step)
  if (isColourOp(step)) return applyColourOp(image, step)
  return applyOutputOp(image, step)
}

/** Applies ops in order; an op Sharp rejects is reported as `ops[index] (name)`. */
export function applySharpOps(image: Sharp, ops: readonly SharpOp[]): Sharp {
  let pipeline = image
  for (const [index, step] of ops.entries()) {
    try {
      pipeline = applySharpOp(pipeline, step)
    } catch (error) {
      throw new SharpOperationError(`ops[${index}] (${step.op})`, error)
    }
  }
  return pipeline
}

function isFormatName(name: string): name is keyof typeof FORMAT_EXTENSIONS {
  return name in FORMAT_EXTENSIONS
}

/** Extension implied by the last op that sets the output format, if any. */
export function formatExtension(ops: readonly SharpOp[]): string | undefined {
  for (const step of [...ops].reverse()) {
    if (step.op === 'tile') return step.container === 'zip' ? '.zip' : '.dz'
    if (step.op === 'toFormat') return FORMAT_EXTENSIONS[step.format]
    if (isFormatName(step.op)) return FORMAT_EXTENSIONS[step.op]
  }
  return undefined
}
