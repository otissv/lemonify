import { z } from 'zod'

import { canvasOfSize } from '@/features/pipeline/canvas'
import type { Canvas, PictureSize } from '@/features/pipeline/canvas'
import { applyChange } from '@/features/pipeline/document-change'
import { layerSettingsOf } from '@/features/pipeline/layer'
import {
  IMAGE_LAYER_KIND,
  createImageLayerStep,
  layerImage,
} from '@/features/pipeline/layer-kinds'
import type { LayerStep } from '@/features/pipeline/layer-kinds'
import {
  PipelineSchema,
  createEmbeddedDocumentStep,
  createPipeline,
  findStep,
  isContainerStep,
  leafSteps,
} from '@/features/pipeline/pipeline'
import type {
  EmbeddedDocumentStep,
  Pipeline,
  PipelineStep,
} from '@/features/pipeline/pipeline'
import { CopyTarget, copyStepsInto } from '@/features/pipeline/step-kinds'
import { defaultOutputSettings } from '@/features/workflows/output-settings'
import { inputSlot } from '@/features/workflows/segments'
import {
  CanvasSize,
  WorkflowDefinitionSchema,
} from '@/features/workflows/workflow'
import type { WorkflowDefinition } from '@/features/workflows/workflow'

/** What a new workflow made from a document does with the document's images. */
export const ImageChoice = {
  /** Every image layer keeps its image. */
  Keep: 'keep',
  /** Every image layer, at any depth of groups and embedded document layers, is emptied, and its image becomes an input. */
  Remove: 'remove',
  /** Only the input slot, the first image layer, is emptied, and its image becomes the input. */
  RemoveInput: 'remove-input',
} as const

export const ImageChoiceSchema = z.enum([
  ImageChoice.Keep,
  ImageChoice.Remove,
  ImageChoice.RemoveInput,
])
export type ImageChoice = z.infer<typeof ImageChoiceSchema>

/** Why a new document or workflow cannot be made from the source given. */
export class CreateFromError extends Error {
  override readonly name = 'CreateFromError'
}

const NOT_FOUND = 'That step is not in the pipeline.'
const NOT_A_CONTAINER =
  'Choose a group or an embedded document layer to make it from.'
const NEEDS_SIZE =
  'This workflow takes the size of each input image and has none. Give the new document a width and height.'
const SIZE_DECIDED =
  'The new document takes its size from the workflow. Leave out the width and height.'

/** The steps a new item is made from: the whole pipeline, or the steps of one group or embedded document layer, whose own placement is left behind. */
function sourceSteps(
  pipeline: Pipeline,
  containerId: string | undefined,
): ReadonlyArray<PipelineStep> {
  if (containerId === undefined) return pipeline.steps
  const found = findStep(pipeline, containerId)
  if (found === undefined) throw new CreateFromError(NOT_FOUND)
  if (!isContainerStep(found.step)) throw new CreateFromError(NOT_A_CONTAINER)
  return found.step.steps
}

function hasImageLayer(steps: ReadonlyArray<PipelineStep>): boolean {
  return leafSteps({ steps }).some((step) => step.kind === IMAGE_LAYER_KIND)
}

/** Whether the choice empties this layer in the new workflow. */
function removes(
  choice: ImageChoice,
  layer: LayerStep,
  slotId: string | undefined,
): boolean {
  if (layer.kind !== IMAGE_LAYER_KIND) return false
  if (choice === ImageChoice.Remove) return true
  return choice === ImageChoice.RemoveInput && layer.id === slotId
}

export type WorkflowFromPipelineOptions = {
  images: ImageChoice
  /** A group or embedded document layer whose steps become the new workflow's top level. */
  containerId?: string
}

/**
 * The definition of a new workflow made from a document's pipeline. Each step
 * is copied by its kind's rule; the images the choice removes become the
 * inputs. The canvas is the document's, at a set size, and the output is the
 * default, since a document stores none. Steps with no image layer get an
 * empty one first, as the input slot.
 */
export function workflowFromPipeline(
  pipeline: Pipeline,
  options: WorkflowFromPipelineOptions,
): WorkflowDefinition {
  const from = sourceSteps(pipeline, options.containerId)
  const slotId = inputSlot({ canvas: pipeline.canvas, steps: [...from] })?.id
  const inputs = new Set<string>()
  const steps = copyStepsInto(from, {
    target: CopyTarget.Workflow,
    layerImage(layer) {
      const image = layerImage(layer)
      if (!removes(options.images, layer, slotId)) return image
      if (image !== undefined) inputs.add(image)
      return undefined
    },
  })
  return WorkflowDefinitionSchema.parse({
    pipeline: createPipeline(
      pipeline.canvas,
      hasImageLayer(steps) ? steps : [createImageLayerStep(), ...steps],
    ),
    canvasSize: CanvasSize.Fixed,
    inputs: [...inputs],
    output: defaultOutputSettings(),
  })
}

/** The name a new item starts from: the container's, when it has one, or else the source's own. */
export function sourceName(
  pipeline: Pipeline,
  containerId: string | undefined,
  fallback: string,
): string {
  if (containerId === undefined) return fallback
  const found = findStep(pipeline, containerId)
  if (found === undefined || !isContainerStep(found.step)) return fallback
  return found.step.name ?? fallback
}

/** The image a workflow shows in its input slot: the last input image added, else the slot's own image. */
export function shownInputImage(
  definition: WorkflowDefinition,
): string | undefined {
  return definition.inputs.at(-1) ?? inputSlot(definition.pipeline)?.sourceId
}

/**
 * The canvas of a new document made from a workflow. A workflow with a set
 * size gives its own canvas; one that takes each input image's size gives the
 * size of the image it shows, or the size given when it shows none, with its
 * background.
 */
export function documentCanvas(
  definition: WorkflowDefinition,
  shownSize: PictureSize | undefined,
  given: PictureSize | undefined,
): Canvas {
  const { canvas } = definition.pipeline
  if (definition.canvasSize === CanvasSize.Fixed || shownSize !== undefined) {
    if (given !== undefined) throw new CreateFromError(SIZE_DECIDED)
  }
  if (definition.canvasSize === CanvasSize.Fixed) return canvas
  const size = shownSize ?? given
  if (size === undefined) throw new CreateFromError(NEEDS_SIZE)
  return {
    ...canvasOfSize(size.width, size.height),
    background: canvas.background,
  }
}

export type DocumentFromWorkflowOptions = {
  canvas: Canvas
  /** A group or embedded document layer whose steps become the new document's top level. */
  containerId?: string
}

/**
 * The pipeline of a new document made from a workflow: the input slot becomes
 * a plain image layer holding the image the workflow shows (empty when it
 * shows none), and every other step is copied by its kind's rule.
 */
export function documentFromWorkflow(
  definition: WorkflowDefinition,
  options: DocumentFromWorkflowOptions,
): Pipeline {
  const shown = shownInputImage(definition)
  const slot = inputSlot(definition.pipeline)
  const filled =
    slot === undefined || shown === undefined
      ? definition.pipeline
      : applyChange(definition.pipeline, {
          type: 'set-image',
          stepId: slot.id,
          sourceId: shown,
        })
  const steps = copyStepsInto(sourceSteps(filled, options.containerId), {
    target: CopyTarget.Document,
    layerImage,
  })
  return PipelineSchema.parse(createPipeline(options.canvas, steps))
}

/**
 * A workflow added to a document: an embedded document layer named after it
 * holding a copy of its steps, not tied to it, with the chosen image in its
 * input slot, or the slot empty when none is chosen.
 */
export function embeddedFromWorkflow(
  definition: WorkflowDefinition,
  name: string,
  sourceId: string | undefined,
): EmbeddedDocumentStep {
  const slotId = inputSlot(definition.pipeline)?.id
  const steps = copyStepsInto(definition.pipeline.steps, {
    target: CopyTarget.Document,
    layerImage: (layer) => (layer.id === slotId ? sourceId : layerImage(layer)),
  })
  return createEmbeddedDocumentStep(steps, name)
}

/** A document as an embedded document layer: named `name`, holding a copy of its steps with their images. */
export function embeddedFromDocument(
  pipeline: Pipeline,
  name: string,
): EmbeddedDocumentStep {
  const steps = copyStepsInto(pipeline.steps, {
    target: CopyTarget.Document,
    layerImage,
  })
  return createEmbeddedDocumentStep(steps, name)
}

/**
 * The embedded document layer a document layer or workflow layer becomes when
 * it is converted: `copy` (of what the layer uses) in the layer's place, with
 * its id, whether it is on, its name when it has one, and where it is placed.
 */
export function convertedLayer(
  layer: LayerStep,
  copy: EmbeddedDocumentStep,
): EmbeddedDocumentStep {
  return {
    ...copy,
    ...layerSettingsOf(layer),
    id: layer.id,
    enabled: layer.enabled,
    ...(layer.name === undefined ? {} : { name: layer.name }),
  }
}

/**
 * A workflow as a workflow layer draws it, for a new item made from that
 * layer: the layer's image is its only input image, or, when the layer has
 * none, it has no input and its input slot is empty.
 */
export function drawnByLayer(
  definition: WorkflowDefinition,
  sourceId: string | undefined,
): WorkflowDefinition {
  if (sourceId !== undefined) return { ...definition, inputs: [sourceId] }
  const slot = inputSlot(definition.pipeline)
  const pipeline =
    slot === undefined || slot.sourceId === undefined
      ? definition.pipeline
      : applyChange(definition.pipeline, {
          type: 'set-image',
          stepId: slot.id,
          sourceId: null,
        })
  return { ...definition, inputs: [], pipeline }
}
