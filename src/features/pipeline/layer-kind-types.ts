/** A stored image as planning needs it. */
export interface ResolvedImage {
  path: string
  contentHash: string
}

export type ImageLookup = (id: string) => Promise<ResolvedImage | undefined>

/** Another of the User's items a layer draws: a document at its own canvas size, or a workflow on the layer's own image. */
export type UsedItem =
  | { kind: 'document'; documentId: string }
  | { kind: 'workflow'; workflowId: string; sourceId?: string }

/** What planning decides about a layer: draw it from a file, draw the picture of another item, leave it out because it has nothing to draw yet, or report that what it draws is gone. */
export type LayerPlan<Identity> =
  | { state: 'empty' }
  | { state: 'gone' }
  /** `identity` is the layer as a render key sees it, its images named by content. */
  | { state: 'ready'; path: string; identity: Identity }
  | { state: 'used'; item: UsedItem }

/** What a sidebar row says about a layer. */
export interface LayerDisplay {
  text: string
  problem: boolean
}

/** The names a row shows for what a layer uses; undefined when that is gone. */
export interface LayerNames {
  image(sourceId: string): string | undefined
  document(documentId: string): string | undefined
  workflow(workflowId: string): string | undefined
}

/**
 * Everything the rest of the app needs to know about one kind of layer, so
 * nothing outside the registry asks what a layer holds: which images and
 * items it uses, whether it is set up, how it is planned and how a row shows it.
 */
export interface LayerKindDefinition<Step, Identity = Step> {
  /** The name a person sees for this kind of layer. */
  title: string
  /** The images the layer owns, which must belong to the document's owner. */
  sourceIds(step: Step): string[]
  /** The same layer with each image it owns named by its entry in `ids`. Throws a RangeError for an image with no entry. */
  withSourceIds(step: Step, ids: ReadonlyMap<string, string>): Step
  /** The same layer drawing this image, or none (undefined); absent for a kind that draws no image of its own. */
  withImage?: (step: Step, sourceId: string | undefined) => Step
  /** The document or workflow the layer draws, which must be the User's own; undefined for a layer that draws an image. */
  uses(step: Step): UsedItem | undefined
  /** The same layer using another document or workflow, named by its entry in `ids`. Throws a RangeError for one with no entry. */
  withUsedIds(step: Step, ids: ReadonlyMap<string, string>): Step
  /** Why the layer cannot be drawn yet, or undefined when it is set up. */
  problem(step: Step): string | undefined
  display(step: Step, names: LayerNames): LayerDisplay
  plan(step: Step, lookup: ImageLookup): Promise<LayerPlan<Identity>>
}

export function mappedId(id: string, ids: ReadonlyMap<string, string>): string {
  const next = ids.get(id)
  if (next === undefined) {
    throw new RangeError(`"${id}" is not known.`)
  }
  return next
}
