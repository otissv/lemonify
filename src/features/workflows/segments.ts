import { canvasOfSize } from '@/features/pipeline/canvas'
import { applyChange } from '@/features/pipeline/document-change'
import { isImageLayer } from '@/features/pipeline/layer-kinds'
import type { ImageLayerStep } from '@/features/pipeline/layer-kinds'
import { effectiveSteps } from '@/features/pipeline/pipeline'
import type { Pipeline } from '@/features/pipeline/pipeline'
import { CanvasSize } from '@/features/workflows/workflow'
import type { WorkflowDefinition } from '@/features/workflows/workflow'

/** The size of an input image, which a run may take for its canvas. */
export type InputImage = { id: string; width: number; height: number }

const NO_INPUT = 'Add at least one image to run the workflow on.'
const NO_SLOT = 'Add an image layer: each input image goes in the first one.'
const NO_SLOT_TO_FILL = 'This pipeline has no place for an input image.'

/**
 * Where an input image goes: the first image layer that is on, in pipeline
 * order, at any depth of groups and embedded document layers, with or without
 * an image. A run replaces its image; every other image layer is fixed and
 * draws the same image in every item.
 */
export function inputSlot(pipeline: Pipeline): ImageLayerStep | undefined {
  for (const step of effectiveSteps(pipeline)) {
    if (isImageLayer(step) && step.enabled) return step
  }
  return undefined
}

/** The pipeline with `sourceId` in its input slot; throws when there is none. */
export function fillInputSlot(pipeline: Pipeline, sourceId: string): Pipeline {
  const slot = inputSlot(pipeline)
  if (slot === undefined) throw new RangeError(NO_SLOT_TO_FILL)
  return applyChange(pipeline, { type: 'set-image', stepId: slot.id, sourceId })
}

/**
 * The pipeline one input image runs through: the workflow's pipeline with the
 * image in its input slot, on the canvas the workflow sets or, when its canvas
 * matches each input image, on a canvas of the image's size with the
 * workflow's background.
 */
export function itemPipeline(
  definition: WorkflowDefinition,
  image: InputImage,
): Pipeline {
  const { pipeline } = definition
  const canvas =
    definition.canvasSize === CanvasSize.MatchInput
      ? {
          ...canvasOfSize(image.width, image.height),
          background: pipeline.canvas.background,
        }
      : pipeline.canvas
  return fillInputSlot({ ...pipeline, canvas }, image.id)
}

/**
 * The pipeline a workflow layer draws: the workflow on the layer's image, as
 * a run's item would be, or, when the layer has no image, the workflow on its
 * own canvas with its input slot empty, as an empty image layer draws nothing.
 */
export function workflowLayerPipeline(
  definition: WorkflowDefinition,
  image: InputImage | undefined,
): Pipeline {
  if (image !== undefined) return itemPipeline(definition, image)
  const slot = inputSlot(definition.pipeline)
  if (slot === undefined || slot.sourceId === undefined) {
    return definition.pipeline
  }
  return applyChange(definition.pipeline, {
    type: 'set-image',
    stepId: slot.id,
    sourceId: null,
  })
}

/** Why a workflow cannot run yet, in plain words, or undefined when it can. */
export function workflowProblem(
  definition: WorkflowDefinition,
): string | undefined {
  if (definition.inputs.length === 0) return NO_INPUT
  if (inputSlot(definition.pipeline) === undefined) return NO_SLOT
  return undefined
}
