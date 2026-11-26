import { z } from 'zod'

import { AI_STEP_KIND, aiStepSchema } from '@/features/ai/ai-tools'
import type { AiContent } from '@/features/ai/ai-tools'
import {
  DEFAULT_LAYER_SETTINGS,
  layerSettingsSchema,
} from '@/features/pipeline/layer'
import { canvasSchema } from '@/features/pipeline/canvas'
import {
  LAYER_KIND_SCHEMAS,
  isImageLayer,
  isLayerStep,
} from '@/features/pipeline/layer-kinds'
import type { ImageLayerStep } from '@/features/pipeline/layer-kinds'
import {
  MAX_STEP_NAME_LENGTH,
  stepEnabledSchema,
  stepNameSchema,
} from '@/features/pipeline/step-common'
import type { Canvas } from '@/features/pipeline/canvas'
import {
  MAX_GROUP_STEPS,
  MAX_NESTING_DEPTH,
  MAX_PIPELINE_STEPS,
  TOO_DEEP,
  TOO_MANY_STEPS,
} from '@/features/pipeline/pipeline-limits'
import { SHARP_OP_CATEGORIES } from '@/lib/images/sharp/ops'
import { stepBlendSchema, supportsBlend } from '@/features/pipeline/step-blend'
/** The kinds of step a pipeline can hold, in a document and in a workflow alike. */
export const PipelineStepKind = {
  Sharp: 'sharp',
  Ai: AI_STEP_KIND,
  /** A named run of steps that is switched, moved and removed as one. The picture is made as if its steps were not grouped. */
  Group: 'group',
  /** A document inside its parent's pipeline: a picture of its own, placed on the parent like a layer. */
  EmbeddedDocument: 'embedded-document',
} as const

/**
 * The Sharp tools an edit can use. The Output group (formats, metadata,
 * tiles, timeout) is left to the Export panel, which covers it.
 */
export const EDITING_OP_NAMES: ReadonlyArray<string> = [
  ...SHARP_OP_CATEGORIES.geometry,
  ...SHARP_OP_CATEGORIES.filter,
  ...SHARP_OP_CATEGORIES.colour,
].filter((op) => op !== 'composite')

const enabled = stepEnabledSchema
const name = stepNameSchema

export { MAX_STEP_NAME_LENGTH }

export {
  MAX_GROUP_STEPS,
  MAX_NESTING_DEPTH,
  MAX_PIPELINE_STEPS,
} from '@/features/pipeline/pipeline-limits'

const sharpStepSchema = z
  .object({
    id: z.uuid(),
    kind: z.literal(PipelineStepKind.Sharp),
    op: z
      .string()
      .refine((op) => EDITING_OP_NAMES.includes(op), 'Not an editing tool'),
    options: z.record(z.string(), z.json()),
    enabled,
    name,
    blend: stepBlendSchema.optional(),
  })
  .refine((step) => step.blend === undefined || supportsBlend(step.op), {
    message: 'Only filters and colour tools can have a blend.',
    path: ['blend'],
  })

const aiStepOptions = aiStepSchema({ id: z.uuid(), enabled, name })

/**
 * A step that does work: a Sharp tool, an AI tool or a layer, plus whether it
 * is switched on.
 */
export const LeafStepSchema = z.discriminatedUnion('kind', [
  sharpStepSchema,
  aiStepOptions,
  ...LAYER_KIND_SCHEMAS,
])

/**
 * A named run of steps that is switched, moved and removed as one. Its steps
 * are part of the picture as if they were not grouped. It holds steps that do
 * work and other groups, never an embedded document layer, which has a
 * picture of its own.
 */
export const GroupStepSchema = z.strictObject({
  id: z.uuid(),
  kind: z.literal(PipelineStepKind.Group),
  enabled,
  name,
  get steps() {
    return z.array(GroupMemberSchema).max(MAX_GROUP_STEPS)
  },
})

/** What a group can hold: steps that do work and groups. */
export const GroupMemberSchema = z.discriminatedUnion('kind', [
  sharpStepSchema,
  aiStepOptions,
  ...LAYER_KIND_SCHEMAS,
  GroupStepSchema,
])

/**
 * A document inside its parent's pipeline: a blank canvas the size of the
 * parent's, which its steps draw on and act on. The result is placed on the
 * parent like a layer, with the placement settings it carries. It holds any
 * step, and has no id, Edit history or Library entry of its own.
 */
export const EmbeddedDocumentStepSchema = layerSettingsSchema.extend({
  id: z.uuid(),
  kind: z.literal(PipelineStepKind.EmbeddedDocument),
  enabled,
  name,
  get steps() {
    return z.array(PipelineStepSchema).max(MAX_GROUP_STEPS)
  },
})

/** A step of a pipeline: a step that does work, a group or an embedded document layer. */
export const PipelineStepSchema = z.discriminatedUnion('kind', [
  sharpStepSchema,
  aiStepOptions,
  ...LAYER_KIND_SCHEMAS,
  GroupStepSchema,
  EmbeddedDocumentStepSchema,
])

/** A group or an embedded document layer: a step that holds steps. */
export const ContainerStepSchema = z.discriminatedUnion('kind', [
  GroupStepSchema,
  EmbeddedDocumentStepSchema,
])

export type PipelineStep = z.output<typeof PipelineStepSchema>
export type LeafStep = z.output<typeof LeafStepSchema>
export type GroupStep = z.output<typeof GroupStepSchema>
export type GroupMember = z.output<typeof GroupMemberSchema>
export type EmbeddedDocumentStep = z.output<typeof EmbeddedDocumentStepSchema>
export type ContainerStep = GroupStep | EmbeddedDocumentStep
export type SharpStep = Extract<LeafStep, { kind: 'sharp' }>
export type {
  ImageLayerStep,
  LayerStep,
} from '@/features/pipeline/layer-kinds'
export type AiStep = Extract<LeafStep, { kind: typeof AI_STEP_KIND }>

type Steps = ReadonlyArray<PipelineStep>

/** Whether a step holds steps: a group or an embedded document layer. */
export function isContainerStep(step: PipelineStep): step is ContainerStep {
  return (
    step.kind === PipelineStepKind.Group ||
    step.kind === PipelineStepKind.EmbeddedDocument
  )
}

function everyId(steps: Steps): string[] {
  return steps.flatMap((step) =>
    isContainerStep(step) ? [step.id, ...everyId(step.steps)] : [step.id],
  )
}

/** How many groups and embedded document layers sit one inside another at the deepest point of these steps. */
export function nestingDepth(steps: Steps): number {
  let deepest = 0
  for (const step of steps) {
    if (!isContainerStep(step)) continue
    deepest = Math.max(deepest, 1 + nestingDepth(step.steps))
  }
  return deepest
}

export const PipelineSchema = z.object({
  canvas: canvasSchema,
  steps: z
    .array(PipelineStepSchema)
    .refine((steps) => new Set(everyId(steps)).size === everyId(steps).length, {
      message: 'Each step can appear once',
    })
    .refine((steps) => everyId(steps).length <= MAX_PIPELINE_STEPS, {
      message: TOO_MANY_STEPS,
    })
    .refine((steps) => nestingDepth(steps) <= MAX_NESTING_DEPTH, {
      message: TOO_DEEP,
    }),
})

export type Pipeline = z.output<typeof PipelineSchema>

export function createSharpStep(
  op: string,
  options: Record<string, z.infer<ReturnType<typeof z.json>>> = {},
): SharpStep {
  return {
    id: crypto.randomUUID(),
    kind: PipelineStepKind.Sharp,
    op,
    options,
    enabled: true,
  }
}

/** A pipeline on this canvas, with the steps given (none by default). */
export function createPipeline(
  canvas: Canvas,
  steps: ReadonlyArray<PipelineStep> = [],
): Pipeline {
  return { canvas, steps: [...steps] }
}

export function createGroupStep(
  steps: ReadonlyArray<GroupMember>,
  groupName?: string,
): GroupStep {
  return {
    id: crypto.randomUUID(),
    kind: PipelineStepKind.Group,
    enabled: true,
    ...(groupName === undefined ? {} : { name: groupName }),
    steps: [...steps],
  }
}

export function createEmbeddedDocumentStep(
  steps: ReadonlyArray<PipelineStep>,
  documentName?: string,
): EmbeddedDocumentStep {
  return {
    id: crypto.randomUUID(),
    kind: PipelineStepKind.EmbeddedDocument,
    enabled: true,
    ...(documentName === undefined ? {} : { name: documentName }),
    ...DEFAULT_LAYER_SETTINGS,
    steps: [...steps],
  }
}

export function createAiStep(content: AiContent<AiStep>): AiStep {
  return {
    id: crypto.randomUUID(),
    kind: PipelineStepKind.Ai,
    enabled: true,
    ...content,
  }
}

/** The same step, and for a container every step in it, under ids of their own, for putting a copy in a pipeline that must not repeat an id. */
export function copyStep<T extends PipelineStep>(step: T): T {
  if (isContainerStep(step)) {
    return { ...step, id: crypto.randomUUID(), steps: step.steps.map(copyStep) }
  }
  return { ...step, id: crypto.randomUUID() }
}

/** Every step that does work, in the order the picture is made, with every container opened. Each keeps its own switch. */
export function leafSteps(pipeline: { steps: Steps }): LeafStep[] {
  return pipeline.steps.flatMap((step) =>
    isContainerStep(step) ? leafSteps(step) : [step],
  )
}

function switchedOff(steps: Steps): LeafStep[] {
  return leafSteps({ steps }).map((step) => ({ ...step, enabled: false }))
}

/**
 * Every step that does work, in order, as it counts when the picture is made:
 * a step under a container that is switched off is off, whatever its own
 * switch says. Embedded document layers are opened too, so a step is found by
 * id wherever it is.
 */
export function effectiveSteps(pipeline: { steps: Steps }): LeafStep[] {
  return pipeline.steps.flatMap((step) => {
    if (!isContainerStep(step)) return [step]
    return step.enabled ? effectiveSteps(step) : switchedOff(step.steps)
  })
}

/** A step as the picture is planned from it: a step that does work, or an embedded document layer that is on. */
export type PlanStep = LeafStep | EmbeddedDocumentStep

/**
 * The steps the picture is planned from, in order. A step under a container
 * that is switched off is off, whatever its own switch says. A group changes
 * nothing else about how its steps are applied, so its steps are listed as if
 * it were not there, at any depth. An embedded document layer that is on stays
 * one step, and the planner makes its picture on its own.
 */
export function planSteps(pipeline: { steps: Steps }): PlanStep[] {
  return pipeline.steps.flatMap((step): PlanStep[] => {
    if (!isContainerStep(step)) return [step]
    if (!step.enabled) return switchedOff(step.steps)
    return step.kind === PipelineStepKind.Group ? planSteps(step) : [step]
  })
}

/**
 * The first layer that is switched on and has an image, among the steps the
 * picture is planned from: the layer of the image the document shows as its
 * original. Layers do not set the canvas; the pipeline's own canvas does.
 */
export function firstImageLayer(pipeline: {
  steps: Steps
}): ImageLayerStep | undefined {
  for (const step of planSteps(pipeline)) {
    if (!isImageLayer(step) || !step.enabled) continue
    if (step.sourceId !== undefined) return step
  }
  return undefined
}

/** The image of the first image layer that is switched on and has one: the document's original. */
export function originalSourceId(pipeline: {
  steps: Steps
}): string | undefined {
  return firstImageLayer(pipeline)?.sourceId
}

/** Whether a pipeline has a step that changes the picture beyond drawing layers: a Sharp tool, an AI tool or an embedded document layer. */
export function hasEdits(pipeline: Pipeline): boolean {
  return pipeline.steps.some((step) => {
    if (step.kind === PipelineStepKind.EmbeddedDocument) return true
    if (step.kind === PipelineStepKind.Group)
      return hasEdits({ ...pipeline, steps: step.steps })
    return !isLayerStep(step)
  })
}

export * from '@/features/pipeline/pipeline-tree'
