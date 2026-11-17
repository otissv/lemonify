import { AI_STEP_KIND } from '@/features/ai/ai-tools'
import { canvasOfSize } from '@/features/pipeline/canvas'
import { applyChange } from '@/features/pipeline/document-change'
import { isLayerStep, layerKind } from '@/features/pipeline/layer-kinds'
import type { ImageLayerStep } from '@/features/pipeline/layer-kinds'
import {
  PipelineStepKind,
  effectiveSteps,
  planSteps,
} from '@/features/pipeline/pipeline'
import type { AiStep, Pipeline, PlanStep } from '@/features/pipeline/pipeline'
import { RunCanvasMode } from '@/features/workflows/workflow'
import type { WorkflowDefinition } from '@/features/workflows/workflow'

/** Layers and Sharp steps drawn on the picture, run as one pass. */
export type DrawSegment = { kind: 'draw'; steps: ReadonlyArray<PlanStep> }
/** One AI step, which runs on the GPU and can be batched with other images. */
export type AiSegment = { kind: 'ai'; step: AiStep }
export type Segment = DrawSegment | AiSegment

/** The size of an input image, which a run may take for its canvas. */
export type InputImage = { id: string; width: number; height: number }

const NO_INPUT = 'Add at least one image to run the workflow on.'
const NO_SLOT = 'Add an image layer with no image: each input image goes in it.'
const AI_IN_SUB_DOCUMENT =
  'AI steps inside a sub-document cannot run in a workflow yet.'
const NO_SLOT_TO_FILL = 'This pipeline has no place for an input image.'

function isSlot(step: { kind: string; enabled: boolean }): boolean {
  return isLayerStep(step) && step.enabled
}

/**
 * The places an input image can go: image layers that are on and have no image,
 * in pipeline order. A run puts each input image in the first, and the rest
 * stay empty, so they draw nothing.
 */
export function inputSlots(pipeline: Pipeline): ImageLayerStep[] {
  const slots: ImageLayerStep[] = []
  for (const step of effectiveSteps(pipeline)) {
    if (!isLayerStep(step) || !isSlot(step)) continue
    if (layerKind(step).sourceIds(step).length === 0) slots.push(step)
  }
  return slots
}

/** The pipeline with `sourceId` in its first input slot; throws when there is none. */
export function fillFirstSlot(pipeline: Pipeline, sourceId: string): Pipeline {
  const [slot] = inputSlots(pipeline)
  if (slot === undefined) throw new RangeError(NO_SLOT_TO_FILL)
  return applyChange(pipeline, { type: 'set-image', stepId: slot.id, sourceId })
}

/**
 * The pipeline one input image runs through: the workflow's pipeline with the
 * image in its first slot, on the workflow's canvas or, for `first-image`, on
 * a canvas of the image's size with the workflow's background.
 */
export function itemPipeline(
  definition: WorkflowDefinition,
  mode: RunCanvasMode,
  image: InputImage,
): Pipeline {
  const { pipeline } = definition
  const canvas =
    mode === RunCanvasMode.FirstImage
      ? {
          ...canvasOfSize(image.width, image.height),
          background: pipeline.canvas.background,
        }
      : pipeline.canvas
  return fillFirstSlot({ ...pipeline, canvas }, image.id)
}

/**
 * Splits a pipeline into what a run executes: layers and Sharp steps are
 * drawn in a draw segment, and every enabled AI step is its own segment. The
 * list always starts and ends with a draw segment (possibly empty), because
 * the first draws the canvas and the last is where the Output settings apply.
 */
export function planSegments(pipeline: Pipeline): Segment[] {
  const segments: Segment[] = []
  let draw: PlanStep[] = []
  for (const step of planSteps(pipeline)) {
    if (step.kind !== AI_STEP_KIND) {
      draw.push(step)
      continue
    }
    if (!step.enabled) continue
    segments.push({ kind: 'draw', steps: draw })
    draw = []
    segments.push({ kind: 'ai', step })
  }
  segments.push({ kind: 'draw', steps: draw })
  return segments
}

function hasAiInSubDocument(pipeline: Pipeline): boolean {
  for (const step of planSteps(pipeline)) {
    if (step.kind !== PipelineStepKind.Group) continue
    if (
      step.steps.some((inner) => inner.kind === AI_STEP_KIND && inner.enabled)
    ) {
      return true
    }
  }
  return false
}

/** Why a workflow cannot run yet, in plain words, or undefined when it can. */
export function workflowProblem(
  definition: WorkflowDefinition,
): string | undefined {
  if (definition.inputs.length === 0) return NO_INPUT
  if (inputSlots(definition.pipeline).length === 0) return NO_SLOT
  if (hasAiInSubDocument(definition.pipeline)) return AI_IN_SUB_DOCUMENT
  return undefined
}
