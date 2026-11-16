import { z } from 'zod'

import {
  PipelineSchema,
  PipelineStepKind,
  PipelineStepSchema,
  insertStep,
  moveStep,
  removeStep,
  replaceStep,
  setStepEnabled,
} from '@/features/pipeline/pipeline'
import type { Pipeline, PipelineStep } from '@/features/pipeline/pipeline'
import { aiToolSchema } from '@/features/ai/ai-tools'
import { layerSettingsSchema } from '@/features/pipeline/layer'
import type { LayerSettings } from '@/features/pipeline/layer'

/** The most changes History keeps for undo; older ones are dropped. */
export const MAX_HISTORY_ENTRIES = 100

/** A change to a Document's Pipeline that is not valid as asked; the message is plain words. */
export class InvalidChangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidChangeError'
  }
}

const SharpOptionsSchema = z.record(z.string(), z.json())

/** One edit of a Pipeline. Each is one History entry, and the client and the server apply it the same way. */
export const DocumentChangeSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('add-step'),
    step: PipelineStepSchema,
    index: z.number().int().nonnegative(),
  }),
  z.strictObject({ type: z.literal('remove-step'), stepId: z.string().min(1) }),
  z.strictObject({
    type: z.literal('move-step'),
    stepId: z.string().min(1),
    to: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('set-options'),
    stepId: z.string().min(1),
    options: SharpOptionsSchema,
  }),
  aiToolSchema({ type: z.literal('set-settings'), stepId: z.string().min(1) }),
  z.strictObject({
    type: z.literal('set-layer'),
    stepId: z.string().min(1),
    settings: layerSettingsSchema,
  }),
  z.strictObject({
    type: z.literal('set-source'),
    stepId: z.string().min(1),
    sourceId: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal('set-enabled'),
    stepId: z.string().min(1),
    enabled: z.boolean(),
  }),
])

export type DocumentChange = z.output<typeof DocumentChangeSchema>

/** A change and the change that undoes it; the pair is what one History entry stores. */
export const HistoryPatchSchema = z.strictObject({
  forward: DocumentChangeSchema,
  inverse: DocumentChangeSchema,
})

export type HistoryPatch = z.output<typeof HistoryPatchSchema>

function stepIndex(pipeline: Pipeline, stepId: string): number {
  return pipeline.steps.findIndex((step) => step.id === stepId)
}

function requireStep(
  pipeline: Pipeline,
  stepId: string,
): { step: PipelineStep; index: number } {
  const index = stepIndex(pipeline, stepId)
  const step = pipeline.steps[index]
  if (step === undefined) {
    throw new InvalidChangeError('That step is no longer in the pipeline.')
  }
  return { step, index }
}

function inverseOf(pipeline: Pipeline, change: DocumentChange): DocumentChange {
  switch (change.type) {
    case 'add-step':
      return { type: 'remove-step', stepId: change.step.id }
    case 'remove-step': {
      const { step, index } = requireStep(pipeline, change.stepId)
      return { type: 'add-step', step, index }
    }
    case 'move-step': {
      const { index } = requireStep(pipeline, change.stepId)
      return { type: 'move-step', stepId: change.stepId, to: index }
    }
    case 'set-options': {
      const { step } = requireStep(pipeline, change.stepId)
      if (step.kind !== PipelineStepKind.Sharp) throw wrongKind()
      return {
        type: 'set-options',
        stepId: change.stepId,
        options: step.options,
      }
    }
    case 'set-settings': {
      const { step } = requireStep(pipeline, change.stepId)
      if (step.kind !== PipelineStepKind.Ai) throw wrongKind()
      return {
        type: 'set-settings',
        stepId: change.stepId,
        tool: step.tool,
        settings: step.settings,
      }
    }
    case 'set-layer': {
      const { step } = requireStep(pipeline, change.stepId)
      if (step.kind !== PipelineStepKind.Layer) throw wrongKind()
      return {
        type: 'set-layer',
        stepId: change.stepId,
        settings: layerSettingsOf(step),
      }
    }
    case 'set-source': {
      const { step } = requireStep(pipeline, change.stepId)
      if (!hasImage(step)) throw wrongKind()
      return {
        type: 'set-source',
        stepId: change.stepId,
        sourceId: step.sourceId,
      }
    }
    case 'set-enabled': {
      const { step } = requireStep(pipeline, change.stepId)
      return {
        type: 'set-enabled',
        stepId: change.stepId,
        enabled: step.enabled,
      }
    }
  }
}

function wrongKind(): InvalidChangeError {
  return new InvalidChangeError('That step does not have those settings.')
}

function hasImage(
  step: PipelineStep,
): step is Extract<
  PipelineStep,
  { kind: typeof PipelineStepKind.Source | typeof PipelineStepKind.Layer }
> {
  return (
    step.kind === PipelineStepKind.Source ||
    step.kind === PipelineStepKind.Layer
  )
}

function layerSettingsOf(
  step: Extract<PipelineStep, { kind: typeof PipelineStepKind.Layer }>,
): LayerSettings {
  const { opacity, blend, fit, scale, rotation, anchor, x, y } = step
  return { opacity, blend, fit, scale, rotation, anchor, x, y }
}

function requireNotImage(pipeline: Pipeline, stepId: string): void {
  if (requireStep(pipeline, stepId).step.kind === PipelineStepKind.Source) {
    throw new InvalidChangeError(
      'The document’s image stays where it is. Replace it to use another.',
    )
  }
}

function applyUnchecked(pipeline: Pipeline, change: DocumentChange): Pipeline {
  switch (change.type) {
    case 'add-step':
      if (stepIndex(pipeline, change.step.id) !== -1) {
        throw new InvalidChangeError('That step is already in the pipeline.')
      }
      return insertStep(pipeline, change.step, change.index)
    case 'remove-step':
      requireNotImage(pipeline, change.stepId)
      return removeStep(pipeline, change.stepId)
    case 'move-step':
      requireNotImage(pipeline, change.stepId)
      return moveStep(pipeline, change.stepId, change.to)
    case 'set-options': {
      const { step } = requireStep(pipeline, change.stepId)
      if (step.kind !== PipelineStepKind.Sharp) throw wrongKind()
      return replaceStep(pipeline, { ...step, options: change.options })
    }
    case 'set-settings': {
      const { step } = requireStep(pipeline, change.stepId)
      if (step.kind !== PipelineStepKind.Ai || step.tool !== change.tool) {
        throw wrongKind()
      }
      return replaceStep(
        pipeline,
        PipelineStepSchema.parse({
          ...step,
          tool: change.tool,
          settings: change.settings,
        }),
      )
    }
    case 'set-layer': {
      const { step } = requireStep(pipeline, change.stepId)
      if (step.kind !== PipelineStepKind.Layer) throw wrongKind()
      return replaceStep(pipeline, { ...step, ...change.settings })
    }
    case 'set-source': {
      const { step } = requireStep(pipeline, change.stepId)
      if (!hasImage(step)) throw wrongKind()
      return replaceStep(pipeline, { ...step, sourceId: change.sourceId })
    }
    case 'set-enabled':
      if (!change.enabled) requireNotImage(pipeline, change.stepId)
      else requireStep(pipeline, change.stepId)
      return setStepEnabled(pipeline, change.stepId, change.enabled)
  }
}

/** Applies a change, checking that the result is still a valid Pipeline. Used for redo and undo too. */
export function applyChange(
  pipeline: Pipeline,
  change: DocumentChange,
): Pipeline {
  const next = applyUnchecked(pipeline, change)
  const checked = PipelineSchema.safeParse(next)
  if (!checked.success) {
    throw new InvalidChangeError(
      checked.error.issues[0]?.message ?? 'That change is not valid.',
    )
  }
  return checked.data
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * The new Pipeline and the History patch for a change, or null when the change
 * leaves the Pipeline as it was, so nothing is recorded.
 */
export function planChange(
  pipeline: Pipeline,
  change: DocumentChange,
): { pipeline: Pipeline; patch: HistoryPatch } | null {
  const inverse = inverseOf(pipeline, change)
  const next = applyChange(pipeline, change)
  if (sameJson(next, pipeline)) return null
  return { pipeline: next, patch: { forward: change, inverse } }
}
