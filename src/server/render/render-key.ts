import { createHash } from 'node:crypto'

import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { AiStep, LayerStep, SharpStep } from '@/features/pipeline/pipeline'

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (typeof value !== 'object' || value === null) return value
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortKeys(Reflect.get(value, key))
  }
  return sorted
}

/** A step as the key sees it. A layer's `sourceId` must already be the image's content hash, so the key means the same wherever the image is stored. */
export type KeyedStep = SharpStep | LayerStep | AiStep

function stepIdentity(step: KeyedStep): unknown {
  switch (step.kind) {
    case PipelineStepKind.Sharp:
      return {
        kind: step.kind,
        op: step.op,
        options: step.options,
        blend: step.blend,
      }
    case PipelineStepKind.Layer: {
      const { id: _id, enabled: _enabled, name: _name, ...identity } = step
      return identity
    }
    case PipelineStepKind.Ai:
      return { kind: step.kind, tool: step.tool, settings: step.settings }
  }
}

/**
 * A hash of a Source's content and the steps applied to it, in order. Equal
 * keys mean equal pixels, so an image found under a key can be reused. Step
 * ids, whether a step is switched on, and the order options were written in
 * do not matter.
 */
export function renderKey(
  sourceHash: string,
  steps: ReadonlyArray<KeyedStep>,
): string {
  const identity = sortKeys({
    source: sourceHash,
    steps: steps.map(stepIdentity),
  })
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex')
}
