import { z } from 'zod'

import { AI_STEP_KIND, aiStepSchema } from '@/features/ai/ai-tools'
import type { AiContent } from '@/features/ai/ai-tools'
import {
  SharpNodeSchema,
  WorkflowNodeKind,
} from '@/features/workflows/workflow-graph'
import { SHARP_OP_CATEGORIES } from '@/lib/images/sharp/ops'

/** The kinds of step a file's pipeline can hold; the same values as the workflow's steps. */
export const PipelineStepKind = {
  Sharp: WorkflowNodeKind.Sharp,
  Ai: AI_STEP_KIND,
  /** Opens an image: the first one switched on is the picture the others edit. */
  Source: 'source',
} as const

/**
 * The Sharp tools an edit can use. The Output group (formats, metadata,
 * tiles, timeout) is left to the Export panel, which covers it.
 */
export const EDITING_OP_NAMES: ReadonlyArray<string> = [
  ...SHARP_OP_CATEGORIES.geometry,
  ...SHARP_OP_CATEGORIES.filter,
  ...SHARP_OP_CATEGORIES.colour,
]

const enabled = z.boolean().default(true)

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
  }),
  aiStepSchema({ id: z.uuid(), enabled }),
  z.strictObject({
    id: z.uuid(),
    kind: z.literal(PipelineStepKind.Source),
    sourceId: z.string().min(1),
    enabled,
  }),
])

export const PipelineSchema = z.object({
  steps: z
    .array(PipelineStepSchema)
    .refine(
      (steps) => new Set(steps.map((step) => step.id)).size === steps.length,
      { message: 'Each step can appear once' },
    ),
})

export type PipelineStep = z.output<typeof PipelineStepSchema>
export type Pipeline = z.output<typeof PipelineSchema>
export type SharpStep = Extract<PipelineStep, { kind: 'sharp' }>
export type SourceStep = Extract<
  PipelineStep,
  { kind: typeof PipelineStepKind.Source }
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

/** Whether a pipeline has a step that changes the picture; Open image steps only choose images. */
export function hasEdits(pipeline: Pipeline): boolean {
  return pipeline.steps.some((step) => step.kind !== PipelineStepKind.Source)
}

/** The step that opens the document's image: the first Open image step, switched on or not. */
export function firstSourceStep(pipeline: Pipeline): SourceStep | undefined {
  return pipeline.steps.find(
    (step): step is SourceStep => step.kind === PipelineStepKind.Source,
  )
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
