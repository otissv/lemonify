import { z } from 'zod'

import {
  DEFAULT_LAYER_SETTINGS,
  MAX_LAYER_OPACITY,
  layerSettingsSchema,
} from '@/features/pipeline/layer'
import {
  stepEnabledSchema,
  stepNameSchema,
} from '@/features/pipeline/step-common'

/** The kind of step that draws an image over the picture as it stands. */
export const IMAGE_LAYER_KIND = 'image-layer'

/**
 * A layer that draws an image. It may be empty: a layer with no image keeps
 * its settings and draws nothing until it has one. Every kind of layer shares
 * the same placement settings (`layerSettingsSchema`), which sub-documents
 * use too.
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
export const LAYER_KIND_SCHEMAS = [imageLayerStepSchema] as const

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

/** A stored image as planning needs it. */
export interface ResolvedImage {
  path: string
  contentHash: string
}

export type ImageLookup = (id: string) => Promise<ResolvedImage | undefined>

/** What planning decides about a layer: draw it from a file, leave it out because it has nothing to draw yet, or report that what it draws is gone. */
export type LayerPlan =
  | { state: 'empty' }
  | { state: 'gone' }
  /** `identity` is the layer as a render key sees it, its images named by content. */
  | { state: 'ready'; path: string; identity: LayerStep }

/** What a sidebar row says about a layer. */
export interface LayerDisplay {
  text: string
  problem: boolean
}

/**
 * Everything the rest of the app needs to know about one kind of layer, so
 * nothing outside this file asks what a layer holds: which images it owns,
 * whether it is set up, how it is planned and how a row shows it.
 */
export interface LayerKindDefinition<Step extends LayerStep> {
  /** The name a person sees for this kind of layer. */
  title: string
  /** The images the layer owns, which must belong to the document's owner. */
  sourceIds(step: Step): string[]
  /** The same layer with each image it owns named by its entry in `ids`. Throws a RangeError for an image with no entry. */
  withSourceIds(step: Step, ids: ReadonlyMap<string, string>): Step
  /** The same layer drawing this image, or none (undefined), which leaves it empty. */
  withImage(step: Step, sourceId: string | undefined): Step
  /** Why the layer cannot be drawn yet, or undefined when it is set up. */
  problem(step: Step): string | undefined
  /** What a row says: `nameOf` finds the name of an image the layer owns. */
  display(step: Step, nameOf: string | undefined): LayerDisplay
  plan(step: Step, lookup: ImageLookup): Promise<LayerPlan>
}

const NO_IMAGE_YET = 'No image yet'
const IMAGE_NOT_AVAILABLE = 'Image not available'

function mapped(id: string, ids: ReadonlyMap<string, string>): string {
  const next = ids.get(id)
  if (next === undefined) {
    throw new RangeError(`The image "${id}" is not known.`)
  }
  return next
}

const imageLayerKind: LayerKindDefinition<ImageLayerStep> = {
  title: 'Image layer',
  sourceIds: (step) => (step.sourceId === undefined ? [] : [step.sourceId]),
  withSourceIds: (step, ids) =>
    step.sourceId === undefined
      ? step
      : { ...step, sourceId: mapped(step.sourceId, ids) },
  withImage: ({ sourceId: _previous, ...rest }, sourceId) =>
    sourceId === undefined ? rest : { ...rest, sourceId },
  problem: () => undefined,
  display(step, nameOf) {
    if (step.sourceId === undefined) {
      return { text: NO_IMAGE_YET, problem: false }
    }
    const parts = [nameOf ?? IMAGE_NOT_AVAILABLE]
    if (step.opacity !== MAX_LAYER_OPACITY) parts.push(`${step.opacity}%`)
    if (step.blend !== DEFAULT_LAYER_SETTINGS.blend) parts.push(step.blend)
    return { text: parts.join(' · '), problem: nameOf === undefined }
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
  [Kind in LayerStepKind]: LayerKindDefinition<
    Extract<LayerStep, { kind: Kind }>
  >
} = {
  [IMAGE_LAYER_KIND]: imageLayerKind,
}

/** Whether a step is a layer of one of the registered kinds. */
export function isLayerStep(step: { kind: string }): step is LayerStep {
  return Object.hasOwn(LAYER_KINDS, step.kind)
}

/** The definition of the kind of a layer. */
export function layerKind(step: LayerStep): LayerKindDefinition<LayerStep> {
  return LAYER_KINDS[step.kind]
}
