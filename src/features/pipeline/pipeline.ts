import { z } from 'zod'

import { AI_STEP_KIND, aiStepSchema } from '@/features/ai/ai-tools'
import type { AiContent } from '@/features/ai/ai-tools'
import {
  SharpNodeSchema,
  WorkflowNodeKind,
} from '@/features/workflows/workflow-graph'
import {
  DEFAULT_LAYER_SETTINGS,
  layerSettingsSchema,
} from '@/features/pipeline/layer'
import { SHARP_OP_CATEGORIES } from '@/lib/images/sharp/ops'
import { stepBlendSchema, supportsBlend } from '@/features/pipeline/step-blend'
/** The kinds of step a file's pipeline can hold; the same values as the workflow's steps. */
export const PipelineStepKind = {
  Sharp: WorkflowNodeKind.Sharp,
  Ai: AI_STEP_KIND,
  /** An image placed over the picture as it stands. The first one that is switched on is the canvas the other steps work on. */
  Layer: 'layer',
  /** A named run of steps that is switched, moved and removed as one. The picture is made as if its steps were not grouped. */
  Group: 'group',
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

const enabled = z.boolean().default(true)

/** The longest name a step can be given. */
export const MAX_STEP_NAME_LENGTH = 60

/** What a person calls the step; the tool's own name is used when there is none. */
const name = z.string().trim().min(1).max(MAX_STEP_NAME_LENGTH).optional()

/** The most steps one group holds. */
export const MAX_GROUP_STEPS = 200
/** The most steps a pipeline holds in all, counting those inside groups. */
export const MAX_PIPELINE_STEPS = 1000

const sharpStepSchema = SharpNodeSchema.omit({ position: true })
  .extend({
    op: z
      .string()
      .refine((op) => EDITING_OP_NAMES.includes(op), 'Not an editing tool'),
    enabled,
    name,
    blend: stepBlendSchema.optional(),
  })
  .refine((step) => step.blend === undefined || supportsBlend(step.op), {
    message: 'Only filters and colour tools can have a blend.',
    path: ['blend'],
  })

const layerStepSchema = z.strictObject({
  id: z.uuid(),
  kind: z.literal(PipelineStepKind.Layer),
  sourceId: z.string().min(1),
  enabled,
  name,
  ...layerSettingsSchema.shape,
})

const aiStepOptions = aiStepSchema({ id: z.uuid(), enabled, name })

/**
 * A step that does work: a workflow step without a place on a canvas, plus
 * whether it is switched on. Built from the workflow's own step schemas so
 * both stay in step.
 */
export const LeafStepSchema = z.discriminatedUnion('kind', [
  sharpStepSchema,
  aiStepOptions,
  layerStepSchema,
])

/**
 * A group holds steps that do work, never another group. By default its steps
 * are part of the picture as if they were not grouped. As a sub-document it
 * is a picture of its own: its first layer that is on sets its size, its steps
 * act on that picture only, and the result is placed on the canvas like a
 * layer, with the layer settings the group carries.
 */
export const GroupStepSchema = z.strictObject({
  id: z.uuid(),
  kind: z.literal(PipelineStepKind.Group),
  enabled,
  name,
  subDocument: z.boolean().default(false),
  ...layerSettingsSchema.shape,
  steps: z.array(LeafStepSchema).max(MAX_GROUP_STEPS),
})

/** A step of a file's pipeline: a step that does work, or a group of them. */
export const PipelineStepSchema = z.discriminatedUnion('kind', [
  sharpStepSchema,
  aiStepOptions,
  layerStepSchema,
  GroupStepSchema,
])

type Steps = ReadonlyArray<z.output<typeof PipelineStepSchema>>

function everyId(steps: Steps): string[] {
  return steps.flatMap((step) =>
    step.kind === PipelineStepKind.Group
      ? [step.id, ...step.steps.map(({ id }) => id)]
      : [step.id],
  )
}

export const PipelineSchema = z.object({
  steps: z
    .array(PipelineStepSchema)
    .refine((steps) => new Set(everyId(steps)).size === everyId(steps).length, {
      message: 'Each step can appear once',
    })
    .refine((steps) => everyId(steps).length <= MAX_PIPELINE_STEPS, {
      message: `A pipeline can have at most ${MAX_PIPELINE_STEPS} steps.`,
    }),
})

export type PipelineStep = z.output<typeof PipelineStepSchema>
export type Pipeline = z.output<typeof PipelineSchema>
export type LeafStep = z.output<typeof LeafStepSchema>
export type GroupStep = z.output<typeof GroupStepSchema>
export type SharpStep = Extract<LeafStep, { kind: 'sharp' }>
export type LayerStep = Extract<
  LeafStep,
  { kind: typeof PipelineStepKind.Layer }
>
export type AiStep = Extract<LeafStep, { kind: typeof AI_STEP_KIND }>

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

export function createLayerStep(sourceId: string): LayerStep {
  return {
    id: crypto.randomUUID(),
    kind: PipelineStepKind.Layer,
    sourceId,
    enabled: true,
    ...DEFAULT_LAYER_SETTINGS,
  }
}

export function createGroupStep(
  steps: ReadonlyArray<LeafStep>,
  groupName?: string,
): GroupStep {
  return {
    id: crypto.randomUUID(),
    kind: PipelineStepKind.Group,
    enabled: true,
    subDocument: false,
    ...DEFAULT_LAYER_SETTINGS,
    ...(groupName === undefined ? {} : { name: groupName }),
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

/** The steps with these ids when they can be grouped: at least one, none a group, none in a group, and next to each other. They come in pipeline order. Undefined otherwise. */
export function groupableSteps(
  pipeline: Pipeline,
  ids: ReadonlyArray<string>,
): LeafStep[] | undefined {
  const wanted = new Set(ids)
  const members: LeafStep[] = []
  let first = -1
  let last = -1
  for (const [index, step] of pipeline.steps.entries()) {
    if (!wanted.has(step.id)) continue
    if (step.kind === PipelineStepKind.Group) return undefined
    if (first === -1) first = index
    last = index
    members.push(step)
  }
  if (members.length === 0 || members.length !== wanted.size) return undefined
  return last - first + 1 === members.length ? members : undefined
}

/** The same step, and for a group the steps in it, under ids of their own, for putting a copy in a pipeline that must not repeat an id. */
export function copyStep<T extends PipelineStep>(step: T): T {
  if (step.kind === PipelineStepKind.Group) {
    return {
      ...step,
      id: crypto.randomUUID(),
      steps: step.steps.map(copyStep),
    }
  }
  return { ...step, id: crypto.randomUUID() }
}

/** Every step that does work, in the order the picture is made, with groups opened. Each keeps its own switch. */
export function leafSteps(pipeline: { steps: Steps }): LeafStep[] {
  return pipeline.steps.flatMap((step) =>
    step.kind === PipelineStepKind.Group ? step.steps : [step],
  )
}

/**
 * Every step that does work, in order, as it counts when the picture is made:
 * a step in a group that is switched off is off, whatever its own switch says.
 * Sub-documents are opened too, so a step is found by id wherever it is.
 */
export function effectiveSteps(pipeline: { steps: Steps }): LeafStep[] {
  return pipeline.steps.flatMap((step) => {
    if (step.kind !== PipelineStepKind.Group) return [step]
    if (step.enabled) return step.steps
    return step.steps.map((inner) => ({ ...inner, enabled: false }))
  })
}

/** A step as the picture is planned from it: a step that does work, or a group that is a sub-document and is on. */
export type PlanStep = LeafStep | GroupStep

/**
 * The steps the picture is planned from, in order. A step in a group that is
 * switched off is off, whatever its own switch says. A group that is not a
 * sub-document changes nothing else about how its steps are applied, so its
 * steps are listed as if it were not there. A group that is a sub-document and
 * is on stays one step, and the planner makes its picture on its own.
 */
export function planSteps(pipeline: { steps: Steps }): PlanStep[] {
  return pipeline.steps.flatMap((step): PlanStep[] => {
    if (step.kind !== PipelineStepKind.Group) return [step]
    if (!step.enabled) {
      return step.steps.map((inner) => ({ ...inner, enabled: false }))
    }
    return step.subDocument ? [step] : step.steps
  })
}

/**
 * The layer that sets the canvas: the first one that is switched on, inside a
 * group that is switched on or not in one. Its image is the picture the steps
 * after it work on, at its own size; later layers are drawn on it and cut off
 * at its edges. Hiding, moving or removing it makes the next layer the canvas.
 * A layer inside a sub-document sets the size of that group's picture, not
 * the canvas.
 */
export function canvasLayer(pipeline: { steps: Steps }): LayerStep | undefined {
  for (const step of planSteps(pipeline)) {
    if (step.kind === PipelineStepKind.Layer && step.enabled) return step
  }
  return undefined
}

/** Whether a pipeline has a step that changes the picture: any step but the layer that sets the canvas. */
export function hasEdits(pipeline: Pipeline): boolean {
  const canvas = canvasLayer(pipeline)
  return leafSteps(pipeline).some((step) => step.id !== canvas?.id)
}

/** Where a step is: at the top, or inside the group `groupId`, and its place in that list. */
export type StepLocation = {
  step: PipelineStep
  index: number
  groupId?: string
}

export function findStep(
  pipeline: Pipeline,
  id: string,
): StepLocation | undefined {
  const top = pipeline.steps.findIndex((step) => step.id === id)
  const found = pipeline.steps[top]
  if (found !== undefined) return { step: found, index: top }
  for (const group of pipeline.steps) {
    if (group.kind !== PipelineStepKind.Group) continue
    const index = group.steps.findIndex((step) => step.id === id)
    const inner = group.steps[index]
    if (inner !== undefined) return { step: inner, index, groupId: group.id }
  }
  return undefined
}

function clamp(index: number, length: number): number {
  return Math.min(Math.max(index, 0), length)
}

function withGroup(
  pipeline: Pipeline,
  groupId: string,
  change: (group: GroupStep) => GroupStep,
): Pipeline {
  return {
    steps: pipeline.steps.map((step) =>
      step.kind === PipelineStepKind.Group && step.id === groupId
        ? change(step)
        : step,
    ),
  }
}

/**
 * Adds `step` at `index` (the end by default; out-of-range places are
 * clamped), at the top or, with `groupId`, inside that group. A group goes only
 * at the top, and a group that is not there leaves the pipeline as it was.
 */
export function insertStep(
  pipeline: Pipeline,
  step: PipelineStep,
  index?: number,
  groupId?: string,
): Pipeline {
  if (groupId === undefined) {
    const steps = [...pipeline.steps]
    steps.splice(clamp(index ?? steps.length, steps.length), 0, step)
    return { steps }
  }
  if (step.kind === PipelineStepKind.Group) return pipeline
  return withGroup(pipeline, groupId, (group) => {
    const steps = [...group.steps]
    steps.splice(clamp(index ?? steps.length, steps.length), 0, step)
    return { ...group, steps }
  })
}

/** Takes a step out of the pipeline, wherever it is; a group goes with the steps it holds. */
export function removeStep(pipeline: Pipeline, id: string): Pipeline {
  return {
    steps: pipeline.steps
      .filter((step) => step.id !== id)
      .map((step) =>
        step.kind === PipelineStepKind.Group
          ? { ...step, steps: step.steps.filter((inner) => inner.id !== id) }
          : step,
      ),
  }
}

/**
 * Moves a step to `index` in the list it is going to, as that list is after
 * the step is taken out: the top of the pipeline, or inside `groupId`.
 */
export function moveStep(
  pipeline: Pipeline,
  id: string,
  index: number,
  groupId?: string,
): Pipeline {
  const found = findStep(pipeline, id)
  if (!found) return pipeline
  return insertStep(removeStep(pipeline, id), found.step, index, groupId)
}

/** Replaces the step with the same id, wherever it is. */
export function replaceStep(pipeline: Pipeline, next: PipelineStep): Pipeline {
  return {
    steps: pipeline.steps.map((step) => {
      if (step.id === next.id) return next
      if (step.kind !== PipelineStepKind.Group) return step
      if (next.kind === PipelineStepKind.Group) return step
      return {
        ...step,
        steps: step.steps.map((inner) => (inner.id === next.id ? next : inner)),
      }
    }),
  }
}

export function setStepEnabled(
  pipeline: Pipeline,
  id: string,
  isEnabled: boolean,
): Pipeline {
  const found = findStep(pipeline, id)
  if (!found) return pipeline
  return replaceStep(pipeline, { ...found.step, enabled: isEnabled })
}
