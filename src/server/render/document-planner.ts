import type { DocumentRecord } from '../dao/document-dao.ts'
import { StaleJobError } from '../jobs/job-handler.ts'
import type { ResultService } from '../services/result-service.ts'
import { planPipeline } from './plan-pipeline.ts'
import { ownedUsedSources, usedPicture } from './used-pictures.ts'
import type { OwnedItems } from './used-pictures.ts'
import type { PipelinePlan } from './plan-pipeline.ts'
import type { PlanLookups } from './plan-pipeline.ts'
import { layerKind } from '@/features/pipeline/layer-kinds'
import type { LayerStep } from '@/features/pipeline/layer-kinds'
import { planSteps } from '@/features/pipeline/pipeline'
import type { PlanStep } from '@/features/pipeline/pipeline'
import { canvasOfSize } from '@/features/pipeline/canvas'
import type { Canvas } from '@/features/pipeline/canvas'

const ASSUMED = 'assumed'

export type PlanOptions = {
  /** The steps to plan, as they count when the picture is made; the whole pipeline, with its groups opened, when not given. */
  steps?: ReadonlyArray<PlanStep>
  assumeAiResults?: boolean
  /** The canvas to plan on; the Document's own when not given. */
  canvas?: Canvas
}

export type DocumentPlannerDependencies = OwnedItems & {
  results: ResultService
}

/**
 * Gets a Document ready for rendering: loads it as the Job saw it and plans
 * its Pipeline over the images of its layers. Used by every handler and
 * by the services that decide what to queue, so a plan means one thing.
 */
export class DocumentPlanner {
  readonly #deps: DocumentPlannerDependencies

  constructor(deps: DocumentPlannerDependencies) {
    this.#deps = deps
  }

  /**
   * The Document a Job was queued for. A Document that is gone, belongs to
   * someone else now, or has moved past the Job's revision makes the Job stale.
   */
  async loadForJob(
    ownerId: string,
    documentId: string,
    revision: number,
  ): Promise<DocumentRecord> {
    const document = await this.#deps.documents.findById(documentId)
    if (
      document === null ||
      document.ownerId !== ownerId ||
      document.revision !== revision
    ) {
      throw new StaleJobError()
    }
    return document
  }

  /**
   * Plans `steps` (the whole Pipeline unless a shorter list is given) on the
   * images the Pipeline opens. With `assumeAiResults`, every AI step counts as having a
   * Result, which is how the keys of all of them are learned.
   */
  async plan(
    document: DocumentRecord,
    options: PlanOptions = {},
  ): Promise<PipelinePlan> {
    const {
      steps = planSteps(document.pipeline),
      assumeAiResults = false,
      canvas = document.pipeline.canvas,
    } = options
    return planPipeline(
      canvas,
      steps,
      this.#lookups(document.ownerId, assumeAiResults),
    )
  }

  /** The canvas of what a layer draws on its own: its image's size, or the canvas of the document or workflow it uses. Undefined when there is nothing to show. */
  async layerCanvas(
    ownerId: string,
    layer: LayerStep,
  ): Promise<Canvas | undefined> {
    const used = layerKind(layer).uses(layer)
    if (used !== undefined) {
      const sources = ownedUsedSources(ownerId, this.#deps)
      return (await usedPicture(used, sources))?.canvas
    }
    const [imageId] = layerKind(layer).sourceIds(layer)
    return imageId === undefined
      ? undefined
      : this.imageCanvas(ownerId, imageId)
  }

  /** A canvas the size of a stored image, or undefined when the image is gone or not the owner's. */
  async imageCanvas(
    ownerId: string,
    sourceId: string,
  ): Promise<Canvas | undefined> {
    const source = await this.#deps.sources.findById(sourceId)
    if (source === null || source.ownerId !== ownerId) return undefined
    return canvasOfSize(source.width, source.height)
  }

  #lookups(ownerId: string, assumeAiResults: boolean): PlanLookups {
    const { results } = this.#deps
    const used = ownedUsedSources(ownerId, this.#deps)
    return {
      aiResultPath: async (key) =>
        assumeAiResults ? ASSUMED : results.findPath(ownerId, key),
      source: used.image,
      used: (item) => usedPicture(item, used),
    }
  }
}
