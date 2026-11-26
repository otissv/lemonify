import { z } from 'zod'

import {
  DEFAULT_LAYER_SETTINGS,
  MAX_LAYER_OPACITY,
  layerSettingsSchema,
} from '@/features/pipeline/layer'
import { mappedId } from '@/features/pipeline/layer-kind-types'
import type { LayerKindDefinition } from '@/features/pipeline/layer-kind-types'
import {
  stepEnabledSchema,
  stepNameSchema,
} from '@/features/pipeline/step-common'
import {
  DOCUMENT_LAYER_KIND,
  WORKFLOW_LAYER_KIND,
  documentLayerKind,
  documentLayerStepSchema,
  workflowLayerKind,
  workflowLayerStepSchema,
} from '@/features/pipeline/used-layer-kinds'
import type {
  DocumentLayerStep,
  WorkflowLayerStep,
} from '@/features/pipeline/used-layer-kinds'

export type {
  ImageLookup,
  LayerDisplay,
  LayerKindDefinition,
  LayerNames,
  LayerPlan,
  ResolvedImage,
  UsedItem,
} from '@/features/pipeline/layer-kind-types'
export {
  DOCUMENT_LAYER_KIND,
  WORKFLOW_LAYER_KIND,
  createDocumentLayerStep,
  createWorkflowLayerStep,
} from '@/features/pipeline/used-layer-kinds'
export type {
  DocumentLayerStep,
  WorkflowLayerStep,
} from '@/features/pipeline/used-layer-kinds'

/** The kind of step that draws an image over the picture as it stands. */
export const IMAGE_LAYER_KIND = 'image-layer'

/**
 * A layer that draws an image. It may be empty: a layer with no image keeps
 * its settings and draws nothing until it has one. Every kind of layer shares
 * the same placement settings (`layerSettingsSchema`), which embedded
 * document layers use too.
 */
export const imageLayerStepSchema = z.strictObject({
  id: z.uuid(),
  kind: z.literal(IMAGE_LAYER_KIND),
  sourceId: z.string().min(1).optional(),
  enabled: stepEnabledSchema,
  name: stepNameSchema,
  ...layerSettingsSchema.shape,
})

/** The schema of every kind of layer. A kind that is not here is refused wherever a pipeline is read. */
export const LAYER_KIND_SCHEMAS = [
  imageLayerStepSchema,
  documentLayerStepSchema,
  workflowLayerStepSchema,
] as const

export type ImageLayerStep = z.output<typeof imageLayerStepSchema>
export type LayerStep = z.output<(typeof LAYER_KIND_SCHEMAS)[number]>
export type LayerStepKind = LayerStep['kind']

export function createImageLayerStep(sourceId?: string): ImageLayerStep {
  return {
    id: crypto.randomUUID(),
    kind: IMAGE_LAYER_KIND,
    ...(sourceId === undefined ? {} : { sourceId }),
    enabled: true,
    ...DEFAULT_LAYER_SETTINGS,
  }
}

const NO_IMAGE_YET = 'No image yet'
const IMAGE_NOT_AVAILABLE = 'Image not available'

const imageLayerKind: LayerKindDefinition<ImageLayerStep> = {
  title: 'Image layer',
  sourceIds: (step) => (step.sourceId === undefined ? [] : [step.sourceId]),
  withSourceIds: (step, ids) =>
    step.sourceId === undefined
      ? step
      : { ...step, sourceId: mappedId(step.sourceId, ids) },
  withImage: ({ sourceId: _previous, ...rest }, sourceId) =>
    sourceId === undefined ? rest : { ...rest, sourceId },
  uses: () => undefined,
  withUsedIds: (step) => step,
  problem: () => undefined,
  display(step, names) {
    if (step.sourceId === undefined) {
      return { text: NO_IMAGE_YET, problem: false }
    }
    const name = names.image(step.sourceId)
    const parts = [name ?? IMAGE_NOT_AVAILABLE]
    if (step.opacity !== MAX_LAYER_OPACITY) parts.push(`${step.opacity}%`)
    if (step.blend !== DEFAULT_LAYER_SETTINGS.blend) parts.push(step.blend)
    return { text: parts.join(' · '), problem: name === undefined }
  },
  async plan(step, lookup) {
    if (step.sourceId === undefined) return { state: 'empty' }
    const image = await lookup(step.sourceId)
    if (image === undefined) return { state: 'gone' }
    return {
      state: 'ready',
      path: image.path,
      identity: { ...step, sourceId: image.contentHash },
    }
  },
}

/** Every kind of layer, by the `kind` of its step. */
export const LAYER_KINDS: {
  [IMAGE_LAYER_KIND]: LayerKindDefinition<ImageLayerStep>
  [DOCUMENT_LAYER_KIND]: LayerKindDefinition<DocumentLayerStep>
  [WORKFLOW_LAYER_KIND]: LayerKindDefinition<WorkflowLayerStep>
} = {
  [IMAGE_LAYER_KIND]: imageLayerKind,
  [DOCUMENT_LAYER_KIND]: documentLayerKind,
  [WORKFLOW_LAYER_KIND]: workflowLayerKind,
}

/** Whether a step is a layer of one of the registered kinds. */
export function isLayerStep(step: { kind: string }): step is LayerStep {
  return Object.hasOwn(LAYER_KINDS, step.kind)
}

/** The definition of one kind, taking any layer and refusing a layer of another kind, which a caller never gives it. */
function forAnyLayer<Step extends LayerStep>(
  definition: LayerKindDefinition<Step>,
  isKind: (step: LayerStep) => step is Step,
): LayerKindDefinition<LayerStep> {
  function own(step: LayerStep): Step {
    if (!isKind(step)) {
      throw new TypeError(`A ${step.kind} is not a ${definition.title}.`)
    }
    return step
  }
  const { withImage } = definition
  return {
    title: definition.title,
    sourceIds: (step) => definition.sourceIds(own(step)),
    withSourceIds: (step, ids) => definition.withSourceIds(own(step), ids),
    ...(withImage === undefined
      ? {}
      : {
          withImage: (step: LayerStep, sourceId: string | undefined) =>
            withImage(own(step), sourceId),
        }),
    uses: (step) => definition.uses(own(step)),
    withUsedIds: (step, ids) => definition.withUsedIds(own(step), ids),
    problem: (step) => definition.problem(own(step)),
    display: (step, names) => definition.display(own(step), names),
    plan: (step, lookup) => definition.plan(own(step), lookup),
  }
}

/** Whether a step is an image layer, not another kind of layer or step. */
export function isImageLayer(step: { kind: string }): step is ImageLayerStep {
  return step.kind === IMAGE_LAYER_KIND
}

function isDocumentLayer(step: LayerStep): step is DocumentLayerStep {
  return step.kind === DOCUMENT_LAYER_KIND
}

function isWorkflowLayer(step: LayerStep): step is WorkflowLayerStep {
  return step.kind === WORKFLOW_LAYER_KIND
}

const ANY_LAYER: Record<LayerStepKind, LayerKindDefinition<LayerStep>> = {
  [IMAGE_LAYER_KIND]: forAnyLayer(imageLayerKind, isImageLayer),
  [DOCUMENT_LAYER_KIND]: forAnyLayer(documentLayerKind, isDocumentLayer),
  [WORKFLOW_LAYER_KIND]: forAnyLayer(workflowLayerKind, isWorkflowLayer),
}

/** The definition of the kind of a layer. */
export function layerKind(step: LayerStep): LayerKindDefinition<LayerStep> {
  return ANY_LAYER[step.kind]
}

/** The image a layer draws (a workflow layer: the one in the workflow's input slot), or undefined when it has none. */
export function layerImage(step: LayerStep): string | undefined {
  return layerKind(step).sourceIds(step)[0]
}
