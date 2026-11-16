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

/** The kinds of step a file's pipeline can hold; the same values as the workflow's steps. */
export const PipelineStepKind = {
  Sharp: WorkflowNodeKind.Sharp,
  Ai: AI_STEP_KIND,
  /** The document's own image: the first step, and the canvas the others work on. */
  Source: 'source',
  /** Another image placed over the picture as it stands. */
  Layer: 'layer',
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

/**
 * A step of a file's pipeline: a workflow step without a place on a canvas,
 * plus whether it is switched on. Built from the workflow's own step
 * schemas so both stay in step.
 */
export const PipelineStepSchema = z.discriminatedUnion('kind', [
  SharpNodeSchema.omit({ position: true }).extend({
    op: z
      .string()
      .refine((op) => EDITING_OP_NAMES.includes(op), 'Not an editing tool'),
    enabled,
    name,
  }),
  aiStepSchema({ id: z.uuid(), enabled, name }),
  z.strictObject({
    id: z.uuid(),
    kind: z.literal(PipelineStepKind.Source),
    sourceId: z.string().min(1),
    enabled,
    name,
  }),
  z.strictObject({
    id: z.uuid(),
    kind: z.literal(PipelineStepKind.Layer),
    sourceId: z.string().min(1),
    enabled,
    name,
    ...layerSettingsSchema.shape,
  }),
])

export const PipelineSchema = z.object({
  steps: z
    .array(PipelineStepSchema)
    .refine(
      (steps) => new Set(steps.map((step) => step.id)).size === steps.length,
      { message: 'Each step can appear once' },
    )
    .refine(
      (steps) =>
        steps.every(
          (step, index) => step.kind !== PipelineStepKind.Source || index === 0,
        ),
      {
        message:
          'The document’s image is the first step, and there is only one.',
      },
    ),
})

export type PipelineStep = z.output<typeof PipelineStepSchema>
export type Pipeline = z.output<typeof PipelineSchema>
export type SharpStep = Extract<PipelineStep, { kind: 'sharp' }>
export type SourceStep = Extract<
  PipelineStep,
  { kind: typeof PipelineStepKind.Source }
>
export type LayerStep = Extract<
  PipelineStep,
  { kind: typeof PipelineStepKind.Layer }
>
export type AiStep = Extract<PipelineStep, { kind: typeof AI_STEP_KIND }>

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

export function createSourceStep(sourceId: string): SourceStep {
  return {
    id: crypto.randomUUID(),
    kind: PipelineStepKind.Source,
    sourceId,
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

/** Whether a pipeline has a step that changes the picture; the document's own image is not one. */
export function hasEdits(pipeline: Pipeline): boolean {
  return pipeline.steps.some((step) => step.kind !== PipelineStepKind.Source)
}

/** The document's image step: the first step, when it is one. */
export function firstSourceStep(pipeline: Pipeline): SourceStep | undefined {
  const [first] = pipeline.steps
  return first?.kind === PipelineStepKind.Source ? first : undefined
}

export function createAiStep(content: AiContent<AiStep>): AiStep {
  return {
    id: crypto.randomUUID(),
    kind: PipelineStepKind.Ai,
    enabled: true,
    ...content,
  }
}

function clamp(index: number, length: number): number {
  return Math.min(Math.max(index, 0), length)
}

/** Adds `step` at `index` (the end by default; out-of-range places are clamped). */
export function insertStep(
  pipeline: Pipeline,
  step: PipelineStep,
  index: number = pipeline.steps.length,
): Pipeline {
  const steps = [...pipeline.steps]
  steps.splice(clamp(index, steps.length), 0, step)
  return { steps }
}

export function removeStep(pipeline: Pipeline, id: string): Pipeline {
  return { steps: pipeline.steps.filter((step) => step.id !== id) }
}

/** Moves a step to `index` in the pipeline as it is after the step is taken out. */
export function moveStep(
  pipeline: Pipeline,
  id: string,
  index: number,
): Pipeline {
  const step = pipeline.steps.find((candidate) => candidate.id === id)
  if (!step) return pipeline
  return insertStep(removeStep(pipeline, id), step, index)
}

export function replaceStep(pipeline: Pipeline, next: PipelineStep): Pipeline {
  return {
    steps: pipeline.steps.map((step) => (step.id === next.id ? next : step)),
  }
}

export function setStepEnabled(
  pipeline: Pipeline,
  id: string,
  isEnabled: boolean,
): Pipeline {
  return {
    steps: pipeline.steps.map((step) =>
      step.id === id ? { ...step, enabled: isEnabled } : step,
    ),
  }
}
