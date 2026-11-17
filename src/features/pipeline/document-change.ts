import { z } from 'zod'

import {
  GroupStepSchema,
  MAX_STEP_NAME_LENGTH,
  PipelineSchema,
  PipelineStepKind,
  PipelineStepSchema,
  findStep,
  insertStep,
  moveStep,
  removeStep,
  replaceStep,
  setStepEnabled,
} from '@/features/pipeline/pipeline'
import type {
  GroupStep,
  LeafStep,
  Pipeline,
  PipelineStep,
  StepLocation,
} from '@/features/pipeline/pipeline'
import { aiToolSchema } from '@/features/ai/ai-tools'
import {
  isDefaultBlend,
  stepBlendSchema,
  supportsBlend,
} from '@/features/pipeline/step-blend'
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
    /** The group to add it to; at the top of the pipeline when there is none. */
    groupId: z.string().min(1).optional(),
  }),
  z.strictObject({ type: z.literal('remove-step'), stepId: z.string().min(1) }),
  z.strictObject({
    type: z.literal('move-step'),
    stepId: z.string().min(1),
    to: z.number().int().nonnegative(),
    /** The group it goes into; the top of the pipeline when there is none. */
    groupId: z.string().min(1).optional(),
  }),
  /** Wraps steps that are next to each other, with this group's steps listed in order, in the group, where the first of them was. */
  z.strictObject({ type: z.literal('group-steps'), group: GroupStepSchema }),
  z.strictObject({ type: z.literal('ungroup'), groupId: z.string().min(1) }),
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
    type: z.literal('set-sub-document'),
    stepId: z.string().min(1),
    subDocument: z.boolean(),
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
  z.strictObject({
    type: z.literal('set-blend'),
    stepId: z.string().min(1),
    /** Null takes the blend away. */
    blend: stepBlendSchema.nullable(),
  }),
  z.strictObject({
    type: z.literal('rename-step'),
    stepId: z.string().min(1),
    /** An empty name goes back to the tool's own name. */
    name: z.string().max(MAX_STEP_NAME_LENGTH * 2),
  }),
])

export type DocumentChange = z.output<typeof DocumentChangeSchema>

/** A change and the change that undoes it; the pair is what one History entry stores. */
export const HistoryPatchSchema = z.strictObject({
  forward: DocumentChangeSchema,
  inverse: DocumentChangeSchema,
})

export type HistoryPatch = z.output<typeof HistoryPatchSchema>

function requireStep(pipeline: Pipeline, stepId: string): StepLocation {
  const found = findStep(pipeline, stepId)
  if (found === undefined) {
    throw new InvalidChangeError('That step is no longer in the pipeline.')
  }
  return found
}

function requireGroup(
  pipeline: Pipeline,
  groupId: string,
): { group: GroupStep; index: number } {
  const found = findStep(pipeline, groupId)
  if (
    found === undefined ||
    found.groupId !== undefined ||
    found.step.kind !== PipelineStepKind.Group
  ) {
    throw new InvalidChangeError('That group is no longer in the pipeline.')
  }
  return { group: found.step, index: found.index }
}

/** Checks that `step` can go in the list `groupId` names, or at the top when that is undefined. */
function requireDestination(
  pipeline: Pipeline,
  step: PipelineStep,
  groupId: string | undefined,
): void {
  if (groupId === undefined) return
  if (step.kind === PipelineStepKind.Group) {
    throw new InvalidChangeError('A group cannot go inside another group.')
  }
  requireGroup(pipeline, groupId)
}

function inverseOf(pipeline: Pipeline, change: DocumentChange): DocumentChange {
  switch (change.type) {
    case 'add-step':
      return { type: 'remove-step', stepId: change.step.id }
    case 'remove-step': {
      const { step, index, groupId } = requireStep(pipeline, change.stepId)
      return { type: 'add-step', step, index, groupId }
    }
    case 'move-step': {
      const { index, groupId } = requireStep(pipeline, change.stepId)
      return { type: 'move-step', stepId: change.stepId, to: index, groupId }
    }
    case 'group-steps':
      return { type: 'ungroup', groupId: change.group.id }
    case 'ungroup': {
      const { group } = requireGroup(pipeline, change.groupId)
      return { type: 'group-steps', group }
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
      if (!hasPlacement(step)) throw wrongKind()
      return {
        type: 'set-layer',
        stepId: change.stepId,
        settings: layerSettingsOf(step),
      }
    }
    case 'set-sub-document': {
      const { group } = requireGroup(pipeline, change.stepId)
      return {
        type: 'set-sub-document',
        stepId: change.stepId,
        subDocument: group.subDocument,
      }
    }
    case 'set-source': {
      const { step } = requireStep(pipeline, change.stepId)
      if (step.kind !== PipelineStepKind.Layer) throw wrongKind()
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
    case 'set-blend': {
      const { step } = requireStep(pipeline, change.stepId)
      if (step.kind !== PipelineStepKind.Sharp) throw wrongKind()
      return {
        type: 'set-blend',
        stepId: change.stepId,
        blend: step.blend ?? null,
      }
    }
    case 'rename-step': {
      const { step } = requireStep(pipeline, change.stepId)
      return {
        type: 'rename-step',
        stepId: change.stepId,
        name: step.name ?? '',
      }
    }
  }
}

function wrongKind(): InvalidChangeError {
  return new InvalidChangeError('That step does not have those settings.')
}

type Placed =
  | GroupStep
  | Extract<LeafStep, { kind: typeof PipelineStepKind.Layer }>

/** Layers, and groups that are sub-documents, are placed on the picture with the layer settings. */
function hasPlacement(step: PipelineStep): step is Placed {
  return (
    step.kind === PipelineStepKind.Layer || step.kind === PipelineStepKind.Group
  )
}

function layerSettingsOf(step: Placed): LayerSettings {
  const { opacity, blend, fit, scale, rotation, anchor, x, y } = step
  return { opacity, blend, fit, scale, rotation, anchor, x, y }
}

/**
 * Wraps the top-level steps `group` lists in the group. They must be there,
 * next to each other and in the order the pipeline has them, so the picture is
 * made in the same order as before.
 */
function groupSteps(pipeline: Pipeline, group: GroupStep): Pipeline {
  if (group.steps.length === 0) {
    throw new InvalidChangeError('Choose at least one step to group.')
  }
  if (findStep(pipeline, group.id) !== undefined) {
    throw new InvalidChangeError('That group is already in the pipeline.')
  }
  const places = group.steps.map((member) => {
    const found = findStep(pipeline, member.id)
    if (found === undefined || found.groupId !== undefined) {
      throw new InvalidChangeError(
        'Only steps that are not in a group can be grouped.',
      )
    }
    if (found.step.kind === PipelineStepKind.Group) {
      throw new InvalidChangeError('A group cannot go inside another group.')
    }
    return found.index
  })
  const first = places[0] ?? 0
  const inOrder = places.every((place, position) => place === first + position)
  if (!inOrder) {
    throw new InvalidChangeError(
      'Group steps that are next to each other, in the order they are in.',
    )
  }
  const steps = [...pipeline.steps]
  steps.splice(first, places.length, group)
  return { steps }
}

function applyUnchecked(pipeline: Pipeline, change: DocumentChange): Pipeline {
  switch (change.type) {
    case 'add-step':
      if (findStep(pipeline, change.step.id) !== undefined) {
        throw new InvalidChangeError('That step is already in the pipeline.')
      }
      requireDestination(pipeline, change.step, change.groupId)
      return insertStep(pipeline, change.step, change.index, change.groupId)
    case 'remove-step':
      requireStep(pipeline, change.stepId)
      return removeStep(pipeline, change.stepId)
    case 'move-step': {
      const { step } = requireStep(pipeline, change.stepId)
      requireDestination(pipeline, step, change.groupId)
      return moveStep(pipeline, change.stepId, change.to, change.groupId)
    }
    case 'group-steps':
      return groupSteps(pipeline, change.group)
    case 'ungroup': {
      const { group, index } = requireGroup(pipeline, change.groupId)
      const steps = [...pipeline.steps]
      steps.splice(index, 1, ...group.steps)
      return { steps }
    }
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
      if (!hasPlacement(step)) throw wrongKind()
      return replaceStep(pipeline, { ...step, ...change.settings })
    }
    case 'set-sub-document': {
      const { group } = requireGroup(pipeline, change.stepId)
      return replaceStep(pipeline, {
        ...group,
        subDocument: change.subDocument,
      })
    }
    case 'set-source': {
      const { step } = requireStep(pipeline, change.stepId)
      if (step.kind !== PipelineStepKind.Layer) throw wrongKind()
      return replaceStep(pipeline, { ...step, sourceId: change.sourceId })
    }
    case 'set-enabled':
      requireStep(pipeline, change.stepId)
      return setStepEnabled(pipeline, change.stepId, change.enabled)
    case 'set-blend': {
      const { step } = requireStep(pipeline, change.stepId)
      if (step.kind !== PipelineStepKind.Sharp || !supportsBlend(step.op)) {
        throw new InvalidChangeError(
          'Only filters and colour tools can have a blend.',
        )
      }
      const { blend: _previous, ...unblended } = step
      const { blend } = change
      if (blend === null || isDefaultBlend(blend)) {
        return replaceStep(pipeline, unblended)
      }
      return replaceStep(pipeline, { ...unblended, blend })
    }
    case 'rename-step': {
      const { step } = requireStep(pipeline, change.stepId)
      const name = change.name.trim()
      if (name.length > MAX_STEP_NAME_LENGTH) {
        throw new InvalidChangeError(
          `Use ${MAX_STEP_NAME_LENGTH} characters or fewer for a name.`,
        )
      }
      if (name !== '') return replaceStep(pipeline, { ...step, name })
      const { name: _previous, ...unnamed } = step
      return replaceStep(pipeline, unnamed)
    }
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
  if (sameJson(next, PipelineSchema.parse(pipeline))) return null
  return { pipeline: next, patch: { forward: change, inverse } }
}
