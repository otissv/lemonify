import { StaleJobError } from '../jobs/job-handler.ts'
import type { WorkflowRecord } from '../dao/workflow-dao.ts'
import { planPipeline } from './plan-pipeline.ts'
import { ownedUsedSources, usedPicture } from './used-pictures.ts'
import type { OwnedItems } from './used-pictures.ts'
import type { PipelinePlan } from './plan-pipeline.ts'
import type { PlanLookups } from './plan-pipeline.ts'
import type { Pipeline, PlanStep } from '@/features/pipeline/pipeline'
import type { Canvas } from '@/features/pipeline/canvas'
import { inputSlot, itemPipeline } from '@/features/workflows/segments'

export type WorkflowPlanOptions = {
  steps: ReadonlyArray<PlanStep>
  canvas: Canvas
}

/** A workflow's pipeline as its pictures show it: with its last input image drawn in, when it has one. */
export type FilledWorkflow = {
  pipeline: Pipeline
  /** The input slot, from the workflow before an image is placed in it. */
  slotId: string | undefined
}

export type WorkflowPlannerDependencies = OwnedItems

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

  /** The pipeline with the workflow's last input image drawn in, on the canvas a run would give it, which is what its diagram pictures show. Left as it is when it has no input image that can be found, or no image layer to put one in (decision 17, input slot). */
  async filled(workflow: WorkflowRecord): Promise<FilledWorkflow> {
    const { definition } = workflow
    const slot = inputSlot(definition.pipeline)
    const shownSourceId = definition.inputs.at(-1)
    const image =
      shownSourceId === undefined
        ? undefined
        : await this.sourceSize(workflow.ownerId, shownSourceId)
    return {
      pipeline:
        slot === undefined || shownSourceId === undefined || image === undefined
          ? definition.pipeline
          : itemPipeline(definition, { id: shownSourceId, ...image }),
      slotId: slot?.id,
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
    const used = ownedUsedSources(ownerId, this.#deps)
    return {
      aiResultPath: async () => undefined,
      source: used.image,
      used: (item) => usedPicture(item, used),
    }
  }
}
