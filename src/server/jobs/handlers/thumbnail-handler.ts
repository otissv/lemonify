import {
  PipelineStepKind,
  createLayerStep,
  planSteps,
} from '@/features/pipeline/pipeline'
import type { LeafStep, PlanStep } from '@/features/pipeline/pipeline'

import type { DocumentRecord } from '../../dao/document-dao.ts'
import { ValidationError } from '../../errors.ts'
import { RenderKind } from '../../tools/render-store.ts'
import { WrongJobKindError, runEach } from '../job-handler.ts'
import type { JobHandler, JobItem, JobReport } from '../job-handler.ts'
import { JobKind, JobState } from '../job-types.ts'
import { ensureRender } from './preview-handler.ts'
import type { RenderHandlerDependencies } from './preview-handler.ts'

/** The steps that show only the image a layer holds: that layer alone, which then is the canvas. */
function ownImage(step: PlanStep): ReadonlyArray<LeafStep> | undefined {
  if (step.kind !== PipelineStepKind.Layer) return undefined
  return [createLayerStep(step.sourceId)]
}

/** For each step in a sub-document: the steps of that sub-document up to and including it, which make its own picture at that step. */
function stepsInSubDocuments(
  steps: ReadonlyArray<PlanStep>,
): Map<string, { shown: ReadonlyArray<LeafStep>; enabled: boolean }> {
  const inside = new Map<
    string,
    { shown: ReadonlyArray<LeafStep>; enabled: boolean }
  >()
  for (const group of steps) {
    if (group.kind !== PipelineStepKind.Group) continue
    for (const [index, step] of group.steps.entries()) {
      inside.set(step.id, {
        shown: ownImage(step) ?? group.steps.slice(0, index + 1),
        enabled: step.enabled,
      })
    }
  }
  return inside
}

/**
 * Renders a small picture of the Document after each of the asked-for steps,
 * and of its own image for a layer. A step that is switched off,
 * not set up, or after an AI step that has no Result yet has no picture (its
 * key is null).
 */
export class ThumbnailHandler implements JobHandler {
  readonly #deps: RenderHandlerDependencies

  constructor(deps: RenderHandlerDependencies) {
    this.#deps = deps
  }

  /** The key of a small picture of `steps`, or null when they cannot make one. A layer shows its own image. */
  async #thumbnailKey(
    document: DocumentRecord,
    steps: ReadonlyArray<PlanStep>,
  ): Promise<string | null> {
    try {
      const plan = await this.#deps.planner.plan(document, { steps })
      if (plan.pending.length > 0 || plan.skipped.length > 0) return null
      return await ensureRender(this.#deps, RenderKind.Thumbnail, plan)
    } catch (error) {
      if (error instanceof ValidationError) return null
      throw error
    }
  }

  run(items: ReadonlyArray<JobItem>): Promise<ReadonlyArray<JobReport>> {
    return runEach(
      items,
      async ({ job, context }) => {
        const { payload } = job
        if (payload.kind !== JobKind.Thumbnail) throw new WrongJobKindError(job)
        const { planner } = this.#deps
        const document = await planner.loadForJob(
          job.ownerId,
          payload.documentId,
          payload.revision,
        )
        const steps = planSteps(document.pipeline)
        const inside = stepsInSubDocuments(steps)
        const thumbnails: Array<{ stepId: string; key: string | null }> = []
        for (const [done, stepId] of payload.stepIds.entries()) {
          context.setProgress(done / payload.stepIds.length)
          const index = steps.findIndex((step) => step.id === stepId)
          const step = steps[index]
          const within = inside.get(stepId)
          const shown =
            step === undefined
              ? within?.shown
              : (ownImage(step) ?? steps.slice(0, index + 1))
          const on = step === undefined ? within?.enabled : step.enabled
          const key =
            shown === undefined || !on
              ? null
              : await this.#thumbnailKey(document, shown)
          thumbnails.push({ stepId, key })
        }
        return {
          outcome: {
            state: JobState.Done,
            result: { kind: JobKind.Thumbnail, thumbnails },
          },
        }
      },
      this.#deps.logger,
    )
  }
}
