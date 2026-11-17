import { z } from 'zod'

import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type {
  LeafStep,
  Pipeline,
  PipelineStep,
} from '@/features/pipeline/pipeline'

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
 * The Source ids a step reads: the image of a layer, or the
 * second images of a boolean operand, joined channels or composite layers
 * (composite only in workflows: a document uses layers instead).
 * Images are always Sources of the same User, never paths.
 */
export function stepOperandSourceIds(step: PipelineStep): string[] {
  if (step.kind === PipelineStepKind.Group) {
    return step.steps.flatMap(stepOperandSourceIds)
  }
  if (step.kind === PipelineStepKind.Layer) return [step.sourceId]
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

/** Every distinct Source a Pipeline uses, in order of first use, including those of steps that are off and steps in groups. */
export function pipelineOperandSourceIds(pipeline: Pipeline): string[] {
  const ids = new Set<string>()
  for (const step of pipeline.steps) {
    for (const id of stepOperandSourceIds(step)) ids.add(id)
  }
  return [...ids]
}

type SourceIds = ReadonlyMap<string, string>

function mapped(id: string, ids: SourceIds): string {
  const next = ids.get(id)
  if (next === undefined)
    throw new RangeError(`The image "${id}" is not known.`)
  return next
}

function remapOptions(
  step: Extract<LeafStep, { kind: typeof PipelineStepKind.Sharp }>,
  ids: SourceIds,
): Record<string, unknown> {
  const { options } = step
  if (step.op === 'boolean') {
    const operand = OperandSchema.safeParse(options)
    return operand.success
      ? { ...options, operand: mapped(operand.data.operand, ids) }
      : options
  }
  if (step.op === 'joinChannel') {
    const join = JoinSchema.safeParse(options)
    if (!join.success) return options
    const { images } = join.data
    return {
      ...options,
      images:
        typeof images === 'string'
          ? mapped(images, ids)
          : images.map((id) => mapped(id, ids)),
    }
  }
  return options
}

/**
 * The same Pipeline with every Source id replaced by its entry in `ids`, for
 * a Pipeline moved to another place where the images have other ids. Throws a
 * RangeError naming an image that has no entry.
 */
export function remapPipelineSources(
  pipeline: Pipeline,
  ids: SourceIds,
): Pipeline {
  const remapStep = (step: LeafStep): LeafStep => {
    if (step.kind === PipelineStepKind.Layer) {
      return { ...step, sourceId: mapped(step.sourceId, ids) }
    }
    if (step.kind !== PipelineStepKind.Sharp) return step
    return { ...step, options: remapOptions(step, ids) as typeof step.options }
  }
  const steps = pipeline.steps.map(
    (step): PipelineStep =>
      step.kind === PipelineStepKind.Group
        ? { ...step, steps: step.steps.map(remapStep) }
        : remapStep(step),
  )
  return { steps }
}
