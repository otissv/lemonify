import { z } from 'zod'

import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { Pipeline, PipelineStep } from '@/features/pipeline/pipeline'

const IdSchema = z.string().min(1)
const OperandSchema = z.object({ operand: IdSchema })
const JoinSchema = z.object({
  images: z.union([IdSchema, z.array(IdSchema)]),
})
const LayersSchema = z.object({
  images: z.array(z.looseObject({ input: z.unknown() })),
})

function layerIds(options: Record<string, unknown>): string[] {
  const layers = LayersSchema.safeParse(options)
  if (!layers.success) return []
  const ids: string[] = []
  for (const layer of layers.data.images) {
    const input = IdSchema.safeParse(layer.input)
    if (input.success) ids.push(input.data)
  }
  return ids
}

/**
 * The Source ids a step reads: the image an Open image step opens, or the
 * second images of a boolean operand, joined channels or composite layers.
 * Images are always Sources of the same User, never paths.
 */
export function stepOperandSourceIds(step: PipelineStep): string[] {
  if (step.kind === PipelineStepKind.Source) return [step.sourceId]
  if (step.kind !== PipelineStepKind.Sharp) return []
  if (step.op === 'boolean') {
    const operand = OperandSchema.safeParse(step.options)
    return operand.success ? [operand.data.operand] : []
  }
  if (step.op === 'joinChannel') {
    const join = JoinSchema.safeParse(step.options)
    if (!join.success) return []
    return typeof join.data.images === 'string'
      ? [join.data.images]
      : join.data.images
  }
  if (step.op === 'composite') return layerIds(step.options)
  return []
}

/** Every distinct Source a Pipeline uses, in order of first use. */
export function pipelineOperandSourceIds(pipeline: Pipeline): string[] {
  const ids = new Set<string>()
  for (const step of pipeline.steps) {
    for (const id of stepOperandSourceIds(step)) ids.add(id)
  }
  return [...ids]
}
