import type { SourceDao } from '../dao/source-dao.ts'
import { StaleJobError } from '../jobs/job-handler.ts'
import type { WorkflowDao, WorkflowRecord } from '../dao/workflow-dao.ts'
import { planPipeline } from './plan-pipeline.ts'
import type { PipelinePlan } from './plan-pipeline.ts'
import type { PlanLookups } from './plan-pipeline.ts'
import type { SourceStore } from '../tools/source-store.ts'
import type { Pipeline, PlanStep } from '@/features/pipeline/pipeline'
import type { Canvas } from '@/features/pipeline/canvas'
import { inputSlots, itemPipeline } from '@/features/workflows/segments'

export type WorkflowPlanOptions = {
  steps: ReadonlyArray<PlanStep>
  canvas: Canvas
}

/** A workflow's pipeline as its pictures show it: with its last input image drawn in, when it has one. */
export type FilledWorkflow = {
  pipeline: Pipeline
  /** The first input slot, from the workflow before an image is placed in it. */
  firstSlotId: string | undefined
}

export type WorkflowPlannerDependencies = {
  workflows: WorkflowDao
  sources: SourceDao
  sourceStore: SourceStore
}

/** Loads a workflow for rendering and plans its pipeline for thumbnails. */
export class WorkflowPlanner {
  readonly #deps: WorkflowPlannerDependencies

  constructor(deps: WorkflowPlannerDependencies) {
    this.#deps = deps
  }

  async loadForJob(
    ownerId: string,
    workflowId: string,
    revision: number,
  ): Promise<WorkflowRecord> {
    const workflow = await this.#deps.workflows.findById(workflowId)
    if (
      workflow === null ||
      workflow.ownerId !== ownerId ||
      workflow.revision !== revision
    ) {
      throw new StaleJobError()
    }
    return workflow
  }

  async plan(
    workflow: WorkflowRecord,
    shown: WorkflowPlanOptions,
  ): Promise<PipelinePlan> {
    return planPipeline(
      shown.canvas,
      shown.steps,
      this.#lookups(workflow.ownerId),
    )
  }

  /** The pipeline with the workflow's last input image drawn in, on the canvas a run would give it, which is what its diagram pictures show. Left empty when it has no input image that can be found. */
  async filled(workflow: WorkflowRecord): Promise<FilledWorkflow> {
    const { definition } = workflow
    const [firstSlot] = inputSlots(definition.pipeline)
    const shownSourceId = definition.inputs.at(-1)
    const image =
      shownSourceId === undefined
        ? undefined
        : await this.sourceSize(workflow.ownerId, shownSourceId)
    return {
      pipeline:
        shownSourceId === undefined || image === undefined
          ? definition.pipeline
          : itemPipeline(definition, { id: shownSourceId, ...image }),
      firstSlotId: firstSlot?.id,
    }
  }

  async sourceSize(
    ownerId: string,
    sourceId: string,
  ): Promise<{ width: number; height: number } | undefined> {
    const source = await this.#deps.sources.findById(sourceId)
    if (source === null || source.ownerId !== ownerId) return undefined
    return { width: source.width, height: source.height }
  }

  #lookups(ownerId: string): PlanLookups {
    const { sources, sourceStore } = this.#deps
    return {
      aiResultPath: async () => undefined,
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
