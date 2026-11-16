import type { DocumentDao, DocumentRecord } from '../dao/document-dao.ts'
import type { SourceDao } from '../dao/source-dao.ts'
import { StaleJobError } from '../jobs/job-handler.ts'
import type { ResultService } from '../services/result-service.ts'
import type { SourceStore } from '../tools/source-store.ts'
import { planPipeline } from './plan-pipeline.ts'
import type { PipelinePlan } from './plan-pipeline.ts'
import type { PlanLookups } from './plan-pipeline.ts'
import type { PipelineStep } from '@/features/pipeline/pipeline'

const ASSUMED = 'assumed'

export type PlanOptions = {
  steps?: ReadonlyArray<PipelineStep>
  assumeAiResults?: boolean
}

export type DocumentPlannerDependencies = {
  documents: DocumentDao
  sources: SourceDao
  sourceStore: SourceStore
  results: ResultService
}

/**
 * Gets a Document ready for rendering: loads it as the Job saw it and plans
 * its Pipeline over the images its Open image steps open. Used by every handler and
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
    const { steps = document.pipeline.steps, assumeAiResults = false } = options
    return planPipeline(steps, this.#lookups(document.ownerId, assumeAiResults))
  }

  #lookups(ownerId: string, assumeAiResults: boolean): PlanLookups {
    const { sources, sourceStore, results } = this.#deps
    return {
      aiResultPath: async (key) =>
        assumeAiResults ? ASSUMED : results.findPath(ownerId, key),
      source: async (sourceId) => {
        const source = await sources.findById(sourceId)
        if (source === null || source.ownerId !== ownerId) return undefined
        return {
          contentHash: source.contentHash,
          path: sourceStore.pathOf(source.contentHash),
        }
      },
    }
  }
}
