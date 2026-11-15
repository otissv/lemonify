import { z } from 'zod'

import { stepOperandSourceIds } from '@/features/pipeline/image-operands'
import type { SharpStep } from '@/features/pipeline/pipeline'

/** Where a Source's bytes are on disk, or undefined when it no longer exists. */
export type SourcePathLookup = (sourceId: string) => Promise<string | undefined>

export type ResolvedStep =
  | { step: SharpStep; problem?: undefined }
  | { step?: undefined; problem: string }

const MISSING_OPERAND = 'A second image this step uses is no longer available.'

const OperandOptionsSchema = z.looseObject({ operand: z.string() })
const JoinOptionsSchema = z.looseObject({
  images: z.union([z.string(), z.array(z.string())]),
})
const LayersOptionsSchema = z.looseObject({
  images: z.array(z.record(z.string(), z.json())),
})

function replaceId(id: string, paths: ReadonlyMap<string, string>): string {
  return paths.get(id) ?? id
}

function withPaths(
  step: SharpStep,
  paths: ReadonlyMap<string, string>,
): SharpStep {
  if (step.op === 'boolean') {
    const parsed = OperandOptionsSchema.safeParse(step.options)
    if (parsed.success) {
      return {
        ...step,
        options: {
          ...step.options,
          operand: replaceId(parsed.data.operand, paths),
        },
      }
    }
  }
  if (step.op === 'joinChannel') {
    const parsed = JoinOptionsSchema.safeParse(step.options)
    if (parsed.success) {
      const { images } = parsed.data
      return {
        ...step,
        options: {
          ...step.options,
          images:
            typeof images === 'string'
              ? replaceId(images, paths)
              : images.map((id) => replaceId(id, paths)),
        },
      }
    }
  }
  if (step.op === 'composite') {
    const parsed = LayersOptionsSchema.safeParse(step.options)
    if (parsed.success) {
      const layers = parsed.data.images.map((layer) =>
        typeof layer.input === 'string'
          ? { ...layer, input: replaceId(layer.input, paths) }
          : layer,
      )
      return { ...step, options: { ...step.options, images: layers } }
    }
  }
  return step
}

/**
 * Swaps the Source ids in a Sharp step's options for the paths of their
 * bytes, so Sharp can read them. A step whose second image is gone cannot run;
 * the result says so in plain words instead.
 */
export async function resolveOperands(
  step: SharpStep,
  sourcePath: SourcePathLookup,
): Promise<ResolvedStep> {
  const ids = stepOperandSourceIds(step)
  if (ids.length === 0) return { step }
  const paths = new Map<string, string>()
  for (const id of ids) {
    const found = await sourcePath(id)
    if (found === undefined) return { problem: MISSING_OPERAND }
    paths.set(id, found)
  }
  return { step: withPaths(step, paths) }
}
