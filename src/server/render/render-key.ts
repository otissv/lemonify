import { createHash } from 'node:crypto'

import { isLayerStep } from '@/features/pipeline/layer-kinds'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { LayerSettings } from '@/features/pipeline/layer'
import type { AiStep, SharpStep } from '@/features/pipeline/pipeline'
import type { ImageLayerStep } from '@/features/pipeline/layer-kinds'

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (typeof value !== 'object' || value === null) return value
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortKeys(Reflect.get(value, key))
  }
  return sorted
}

/** A sub-document as the key sees it: what its picture starts from, the steps it applies as the key sees them, and where it is placed. */
export interface KeyedSubDocument extends LayerSettings {
  kind: typeof PipelineStepKind.Group
  base: string
  steps: ReadonlyArray<KeyedStep>
}

/** A step as the key sees it. A layer's `sourceId` must already be the image's content hash, so the key means the same wherever the image is stored. */
export type KeyedStep = SharpStep | ImageLayerStep | AiStep | KeyedSubDocument

function stepIdentity(step: KeyedStep): unknown {
  if (isLayerStep(step)) {
    const { id: _id, enabled: _enabled, name: _name, ...identity } = step
    return identity
  }
  switch (step.kind) {
    case PipelineStepKind.Sharp:
      return {
        kind: step.kind,
        op: step.op,
        options: step.options,
        blend: step.blend,
      }
    case PipelineStepKind.Ai:
      return { kind: step.kind, tool: step.tool, settings: step.settings }
    case PipelineStepKind.Group:
      return { ...step, steps: step.steps.map(stepIdentity) }
  }
}

/**
 * A hash of what a picture starts from (the canvas) and the steps applied to
 * it, in order. Equal keys mean equal pixels, so an image found under a key
 * can be reused. Step ids, whether a step is switched on, and the order
 * options were written in do not matter.
 */
export function renderKey(
  baseKey: string,
  steps: ReadonlyArray<KeyedStep>,
): string {
  const identity = sortKeys({
    base: baseKey,
    steps: steps.map(stepIdentity),
  })
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex')
}
