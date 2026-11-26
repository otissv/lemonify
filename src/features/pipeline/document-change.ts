import { z } from 'zod'

import {
  ContainerStepSchema,
  EmbeddedDocumentStepSchema,
  MAX_STEP_NAME_LENGTH,
  PipelineSchema,
  PipelineStepKind,
  PipelineStepSchema,
  findStep,
  insertStep,
  isContainerStep,
  isGroupMember,
  holdsEmbedded,
  placementProblem,
  GROUP_HOLDS_NO_EMBEDDED,
  moveStep,
  removeStep,
  replaceStep,
  setStepEnabled,
} from '@/features/pipeline/pipeline'
import {
  LAYER_KIND_SCHEMAS,
  isLayerStep,
  layerKind,
} from '@/features/pipeline/layer-kinds'
import type { LayerStep } from '@/features/pipeline/layer-kinds'
import type {
  ContainerStep,
  EmbeddedDocumentStep,
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
import { canvasSchema, pictureSizeSchema } from '@/features/pipeline/canvas'
import {
  DEFAULT_LAYER_SETTINGS,
  layerSettingsOf,
  layerSettingsSchema,
} from '@/features/pipeline/layer'
import { AiStartingSchema, resetStep } from '@/features/pipeline/step-reset'

/** The most changes the Edit history keeps for undo; older ones are dropped. */
export const MAX_HISTORY_ENTRIES = 100

/** A change to a Document's Pipeline that is not valid as asked; the message is plain words. */
export class InvalidChangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidChangeError'
  }
}

const SharpOptionsSchema = z.record(z.string(), z.json())

/** One edit of a Pipeline. Each is one Edit history entry, and the client and the server apply it the same way. */
export const DocumentChangeSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('add-step'),
    step: PipelineStepSchema,
    index: z.number().int().nonnegative(),
    /** The group or embedded document layer to add it to; at the top of the pipeline when there is none. */
    parentId: z.string().min(1).optional(),
  }),
  z.strictObject({ type: z.literal('remove-step'), stepId: z.string().min(1) }),
  z.strictObject({
    type: z.literal('move-step'),
    stepId: z.string().min(1),
    to: z.number().int().nonnegative(),
    /** The group or embedded document layer it goes into; the top of the pipeline when there is none. */
    parentId: z.string().min(1).optional(),
  }),
  /** Wraps steps that are next to each other in one list, with this container's steps listed in order, in the container, where the first of them was. */
  z.strictObject({
    type: z.literal('group-steps'),
    group: ContainerStepSchema,
  }),
  /** Takes the steps out of a group or an embedded document layer, leaving them where it was. */
  z.strictObject({ type: z.literal('ungroup'), stepId: z.string().min(1) }),
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
  /** Makes a group an embedded document layer (placed with the default settings), or one a group again (its placement dropped). */
  z.strictObject({
    type: z.literal('set-embedded'),
    stepId: z.string().min(1),
    embedded: z.boolean(),
  }),
  /** Gives a layer an image, or, with null, takes it away and leaves the layer empty. */
  z.strictObject({
    type: z.literal('set-image'),
    stepId: z.string().min(1),
    sourceId: z.string().min(1).nullable(),
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
  /** Gives the pipeline a different canvas: its size and background. The steps are left as they are. */
  z.strictObject({ type: z.literal('set-canvas'), canvas: canvasSchema }),
  /** Puts a step back as a new one of its kind starts (see `resetStep`); an AI step names the settings its catalogue starts from. */
  z.strictObject({
    type: z.literal('reset-step'),
    stepId: z.string().min(1),
    ai: AiStartingSchema.optional(),
    /** The size of the picture the step acts on, which a resize starts at. */
    size: pictureSizeSchema.optional(),
  }),
  /** Puts a whole step back as it was, which is how a reset is undone. */
  z.strictObject({ type: z.literal('restore-step'), step: PipelineStepSchema }),
  /** Puts an embedded document layer holding a copy of what a document layer or workflow layer uses in that layer's place, with the layer's id. */
  z.strictObject({
    type: z.literal('convert-step'),
    step: EmbeddedDocumentStepSchema,
  }),
  /** Puts a document layer or workflow layer back where it was converted, which is how a convert is undone. */
  z.strictObject({
    type: z.literal('restore-layer'),
    step: z.discriminatedUnion('kind', [...LAYER_KIND_SCHEMAS]),
  }),
  z.strictObject({
    type: z.literal('rename-step'),
    stepId: z.string().min(1),
    /** An empty name goes back to the tool's own name. */
    name: z.string().max(MAX_STEP_NAME_LENGTH * 2),
  }),
])

export type DocumentChange = z.output<typeof DocumentChangeSchema>

const DOCUMENT_CHANGE_TYPES: ReadonlySet<unknown> =
  DocumentChangeSchema._zod.propValues.type ?? new Set()

/** Whether a change of any kind is one a document takes: every kind but the few only a workflow has. */
export function isDocumentChange(change: {
  type: string
}): change is DocumentChange {
  return DOCUMENT_CHANGE_TYPES.has(change.type)
}

/** A change and the change that undoes it; the pair is what one Edit history entry stores. */
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

function requireContainer(
  pipeline: Pipeline,
  stepId: string,
): StepLocation & { step: ContainerStep } {
  const found = findStep(pipeline, stepId)
  if (found === undefined || !isContainerStep(found.step)) {
    throw new InvalidChangeError(
      'That group or embedded document layer is no longer in the pipeline.',
    )
  }
  return { ...found, step: found.step }
}

/** Checks that `step` can go in the list `parentId` names, or at the top when that is undefined. */
function requireDestination(
  pipeline: Pipeline,
  step: PipelineStep,
  parentId: string | undefined,
): void {
  const problem = placementProblem(pipeline, step, parentId)
  if (problem !== undefined) throw new InvalidChangeError(problem)
}

function inverseOf(pipeline: Pipeline, change: DocumentChange): DocumentChange {
  switch (change.type) {
    case 'add-step':
      return { type: 'remove-step', stepId: change.step.id }
    case 'remove-step': {
      const { step, index, parentId } = requireStep(pipeline, change.stepId)
      return { type: 'add-step', step, index, parentId }
    }
    case 'move-step': {
      const { index, parentId } = requireStep(pipeline, change.stepId)
      return { type: 'move-step', stepId: change.stepId, to: index, parentId }
    }
    case 'group-steps':
      return { type: 'ungroup', stepId: change.group.id }
    case 'ungroup':
      return {
        type: 'group-steps',
        group: requireContainer(pipeline, change.stepId).step,
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
    case 'set-embedded':
      return {
        type: 'restore-step',
        step: requireContainer(pipeline, change.stepId).step,
      }
    case 'set-image': {
      const { step } = requireStep(pipeline, change.stepId)
      if (!isLayerStep(step) || layerKind(step).withImage === undefined) {
        throw wrongKind()
      }
      return {
        type: 'set-image',
        stepId: change.stepId,
        sourceId: layerKind(step).sourceIds(step)[0] ?? null,
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
    case 'set-canvas':
      return { type: 'set-canvas', canvas: pipeline.canvas }
    case 'reset-step':
      return {
        type: 'restore-step',
        step: requireStep(pipeline, change.stepId).step,
      }
    case 'restore-step':
      return {
        type: 'restore-step',
        step: requireStep(pipeline, change.step.id).step,
      }
    case 'convert-step':
      return {
        type: 'restore-layer',
        step: requireUsedLayer(pipeline, change.step.id),
      }
    case 'restore-layer':
      return {
        type: 'convert-step',
        step: requireEmbedded(pipeline, change.step.id),
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

/** The document layer or workflow layer `stepId`: one that uses another item. */
function requireUsedLayer(pipeline: Pipeline, stepId: string): LayerStep {
  const { step } = requireStep(pipeline, stepId)
  if (!isLayerStep(step) || layerKind(step).uses(step) === undefined) {
    throw new InvalidChangeError(
      'Only a document layer or a workflow layer can be converted.',
    )
  }
  return step
}

function requireEmbedded(
  pipeline: Pipeline,
  stepId: string,
): EmbeddedDocumentStep {
  const { step } = requireStep(pipeline, stepId)
  if (step.kind !== PipelineStepKind.EmbeddedDocument) throw wrongKind()
  return step
}

function wrongKind(): InvalidChangeError {
  return new InvalidChangeError('That step does not have those settings.')
}

type Placed = LayerStep | EmbeddedDocumentStep

/** Layers and embedded document layers are placed on the picture with the layer settings. */
function hasPlacement(step: PipelineStep): step is Placed {
  return isLayerStep(step) || step.kind === PipelineStepKind.EmbeddedDocument
}

/**
 * Wraps the steps `group` lists in the container. They must be in one list,
 * next to each other and in the order the pipeline has them, so the picture
 * is made in the same order as before.
 */
function groupSteps(pipeline: Pipeline, group: ContainerStep): Pipeline {
  const [first] = group.steps
  if (first === undefined) {
    throw new InvalidChangeError('Choose at least one step to group.')
  }
  if (findStep(pipeline, group.id) !== undefined) {
    throw new InvalidChangeError('That group is already in the pipeline.')
  }
  const parentId = findStep(pipeline, first.id)?.parentId
  const places = group.steps.map((member) => {
    const found = findStep(pipeline, member.id)
    if (found === undefined || found.parentId !== parentId) {
      throw new InvalidChangeError(
        'Group steps that are in the same list, next to each other.',
      )
    }
    return found.index
  })
  const start = places[0] ?? 0
  const inOrder = places.every((place, position) => place === start + position)
  if (!inOrder) {
    throw new InvalidChangeError(
      'Group steps that are next to each other, in the order they are in.',
    )
  }
  requireDestination(pipeline, group, parentId)
  let next = pipeline
  for (const member of group.steps) next = removeStep(next, member.id)
  return insertStep(next, group, start, parentId)
}

/** Takes the steps out of a container and puts them where it was. */
function ungroup(pipeline: Pipeline, stepId: string): Pipeline {
  const { step, index, parentId } = requireContainer(pipeline, stepId)
  let next = removeStep(pipeline, stepId)
  for (const [offset, member] of step.steps.entries()) {
    requireDestination(next, member, parentId)
    next = insertStep(next, member, index + offset, parentId)
  }
  return next
}

/** A group as an embedded document layer, placed with the default settings, or an embedded document layer as a group, its placement dropped. */
function setEmbedded(
  pipeline: Pipeline,
  stepId: string,
  embedded: boolean,
): Pipeline {
  const { step, parentId } = requireContainer(pipeline, stepId)
  const { id, enabled, name } = step
  const named = name === undefined ? {} : { name }
  if (!embedded) {
    const steps: PipelineStep[] = [...step.steps]
    if (steps.some(holdsEmbedded)) {
      throw new InvalidChangeError(GROUP_HOLDS_NO_EMBEDDED)
    }
    return replaceStep(pipeline, {
      id,
      kind: PipelineStepKind.Group,
      enabled,
      ...named,
      steps: steps.filter(isGroupMember),
    })
  }
  if (step.kind === PipelineStepKind.EmbeddedDocument) return pipeline
  const holder =
    parentId === undefined ? undefined : findStep(pipeline, parentId)?.step
  if (holder?.kind === PipelineStepKind.Group) {
    throw new InvalidChangeError(GROUP_HOLDS_NO_EMBEDDED)
  }
  const placed: EmbeddedDocumentStep = {
    id,
    kind: PipelineStepKind.EmbeddedDocument,
    enabled,
    ...named,
    ...DEFAULT_LAYER_SETTINGS,
    steps: [...step.steps],
  }
  return replaceStep(pipeline, placed)
}

function applyUnchecked(pipeline: Pipeline, change: DocumentChange): Pipeline {
  switch (change.type) {
    case 'add-step':
      if (findStep(pipeline, change.step.id) !== undefined) {
        throw new InvalidChangeError('That step is already in the pipeline.')
      }
      requireDestination(pipeline, change.step, change.parentId)
      return insertStep(pipeline, change.step, change.index, change.parentId)
    case 'remove-step':
      requireStep(pipeline, change.stepId)
      return removeStep(pipeline, change.stepId)
    case 'move-step': {
      const { step } = requireStep(pipeline, change.stepId)
      requireDestination(pipeline, step, change.parentId)
      return moveStep(pipeline, change.stepId, change.to, change.parentId)
    }
    case 'group-steps':
      return groupSteps(pipeline, change.group)
    case 'ungroup':
      return ungroup(pipeline, change.stepId)
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
    case 'set-embedded':
      return setEmbedded(pipeline, change.stepId, change.embedded)
    case 'set-image': {
      const { step } = requireStep(pipeline, change.stepId)
      if (!isLayerStep(step)) throw wrongKind()
      const { withImage } = layerKind(step)
      if (withImage === undefined) throw wrongKind()
      return replaceStep(
        pipeline,
        withImage(step, change.sourceId ?? undefined),
      )
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
    case 'set-canvas':
      return { ...pipeline, canvas: change.canvas }
    case 'reset-step': {
      const { step } = requireStep(pipeline, change.stepId)
      const reset = resetStep(pipeline, step, change)
      if (reset === undefined) {
        throw new InvalidChangeError(
          'Resetting an AI step needs the settings its tool starts with.',
        )
      }
      return replaceStep(pipeline, reset)
    }
    case 'convert-step':
      requireUsedLayer(pipeline, change.step.id)
      return replaceStep(pipeline, change.step)
    case 'restore-layer':
      requireEmbedded(pipeline, change.step.id)
      if (layerKind(change.step).uses(change.step) === undefined) {
        throw wrongKind()
      }
      return replaceStep(pipeline, change.step)
    case 'restore-step': {
      const { step } = requireStep(pipeline, change.step.id)
      const containers = isContainerStep(step) && isContainerStep(change.step)
      if (step.kind !== change.step.kind && !containers) throw wrongKind()
      return replaceStep(pipeline, change.step)
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
