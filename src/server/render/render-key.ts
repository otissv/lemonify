import { createHash } from 'node:crypto'

import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { AiStep, SharpStep } from '@/features/pipeline/pipeline'

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (typeof value !== 'object' || value === null) return value
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortKeys(Reflect.get(value, key))
  }
  return sorted
}

function stepIdentity(step: SharpStep | AiStep): unknown {
  if (step.kind === PipelineStepKind.Sharp) {
    return { kind: step.kind, op: step.op, options: step.options }
  }
  return { kind: step.kind, tool: step.tool, settings: step.settings }
}

/**
 * A hash of a Source's content and the steps applied to it, in order. Equal
 * keys mean equal pixels, so an image found under a key can be reused. Step
 * ids, whether a step is switched on, and the order options were written in
 * do not matter.
 */
export function renderKey(
  sourceHash: string,
  steps: ReadonlyArray<SharpStep | AiStep>,
): string {
  const identity = sortKeys({
    source: sourceHash,
    steps: steps.map(stepIdentity),
  })
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex')
}
