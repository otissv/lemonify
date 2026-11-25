import { z } from 'zod'

import { canvasOfSize } from '@/features/pipeline/canvas'
import type { Canvas } from '@/features/pipeline/canvas'
import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import { PipelineSchema, createPipeline } from '@/features/pipeline/pipeline'
import {
  OutputSettingsSchema,
  defaultOutputSettings,
} from '@/features/workflows/output-settings'

export const MAX_WORKFLOW_NAME_LENGTH = 80
export const MAX_WORKFLOW_INPUTS = 1000

export const WorkflowNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(
    MAX_WORKFLOW_NAME_LENGTH,
    `Use ${MAX_WORKFLOW_NAME_LENGTH} characters or fewer.`,
  )

export const DEFAULT_WORKFLOW_CANVAS: Canvas = canvasOfSize(1920, 1080)

/**
 * How big a workflow's canvas is for each input image. `match-input` takes
 * the size of the image and keeps the canvas's background, as a document
 * opened on that image would; `fixed` keeps the width and height set on the
 * canvas for every image.
 */
export const CanvasSize = {
  MatchInput: 'match-input',
  Fixed: 'fixed',
} as const

export const CanvasSizeSchema = z.enum([
  CanvasSize.MatchInput,
  CanvasSize.Fixed,
])
export type CanvasSize = z.infer<typeof CanvasSizeSchema>

const InputsSchema = z
  .array(z.string().min(1))
  .max(MAX_WORKFLOW_INPUTS)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'Each input image can be used once',
  })

const DefinitionShape = {
  pipeline: PipelineSchema,
  canvasSize: CanvasSizeSchema,
  inputs: InputsSchema,
  output: OutputSettingsSchema,
}

/**
 * What a workflow is, and what a run copies: the same pipeline a document has
 * (canvas and steps), whether the canvas takes each input image's size, the
 * library images it runs on, and how it writes its results. Its input slots are the empty image layers in the pipeline.
 */
export const WorkflowDefinitionSchema = z.strictObject(DefinitionShape)

export const WorkflowSchema = z.strictObject({
  id: z.uuid(),
  name: WorkflowNameSchema,
  ...DefinitionShape,
})

export type WorkflowDefinition = z.output<typeof WorkflowDefinitionSchema>
export type Workflow = z.infer<typeof WorkflowSchema>

const NAME_PREFIX = 'Workflow'
const NUMBERED_NAME = new RegExp(`^${NAME_PREFIX} (\\d+)$`)
const DUPLICATE_NAME = 'A workflow with this name already exists.'

function normalise(name: string): string {
  return name.trim().toLocaleLowerCase()
}

/** The name the Add workflow dialog suggests, numbered after the existing workflows. */
export function nextWorkflowName(
  existing: ReadonlyArray<{ name: string }>,
): string {
  let highest = existing.length
  for (const { name } of existing) {
    const number = NUMBERED_NAME.exec(name)?.[1]
    if (number) highest = Math.max(highest, Number(number))
  }
  return `${NAME_PREFIX} ${highest + 1}`
}

/** Why a name cannot be used for a new workflow, or null if it can. */
export function workflowNameProblem(
  name: string,
  existing: ReadonlyArray<{ name: string }>,
): string | null {
  const parsed = WorkflowNameSchema.safeParse(name)
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Invalid name.'
  const wanted = normalise(parsed.data)
  const taken = existing.some((workflow) => normalise(workflow.name) === wanted)
  return taken ? DUPLICATE_NAME : null
}

/** A new workflow: one empty image layer for the input, no steps, a canvas that matches each input image, and the default output. */
export function createWorkflow(
  name: string,
  canvas: Canvas = DEFAULT_WORKFLOW_CANVAS,
): Workflow {
  return WorkflowSchema.parse({
    id: crypto.randomUUID(),
    name,
    pipeline: createPipeline(canvas, [createImageLayerStep()]),
    canvasSize: CanvasSize.MatchInput,
    inputs: [],
    output: defaultOutputSettings(),
  })
}
