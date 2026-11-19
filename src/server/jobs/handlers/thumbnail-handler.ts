import { PipelineStepKind, planSteps } from '@/features/pipeline/pipeline'
import type { LeafStep, PlanStep } from '@/features/pipeline/pipeline'
import { stepsBefore } from '@/features/pipeline/step-input'
import type { Canvas } from '@/features/pipeline/canvas'
import { DEFAULT_LAYER_SETTINGS } from '@/features/pipeline/layer'
import { isLayerStep, layerKind } from '@/features/pipeline/layer-kinds'
import type { ImageLayerStep } from '@/features/pipeline/layer-kinds'

import type { DocumentRecord } from '../../dao/document-dao.ts'
import { RenderKind } from '../../tools/render-store.ts'
import { WrongJobKindError, runEach } from '../job-handler.ts'
import type { JobHandler, JobItem, JobReport } from '../job-handler.ts'
import { JobKind, JobState } from '../job-types.ts'
import { ensureRender } from './preview-handler.ts'
import type { RenderHandlerDependencies } from './preview-handler.ts'

/** What a small picture shows: steps on a canvas; the document's own canvas when none is given. */
type Shown = { steps: ReadonlyArray<PlanStep>; canvas?: Canvas }

/** A layer shows only its own image, as it is, on a canvas the size of that image. Undefined for a layer with no image to show. */
async function ownImage(
  layer: ImageLayerStep,
  document: DocumentRecord,
  planner: RenderHandlerDependencies['planner'],
): Promise<Shown | undefined> {
  const [imageId] = layerKind(layer).sourceIds(layer)
  if (imageId === undefined) return undefined
  const canvas = await planner.imageCanvas(document.ownerId, imageId)
  if (canvas === undefined) return undefined
  return { steps: [{ ...layer, ...DEFAULT_LAYER_SETTINGS }], canvas }
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
        shown: group.steps.slice(0, index + 1),
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

  /** The key of a small picture of `steps`, or null when they cannot make one, so one picture that fails does not take the others with it. A layer shows its own image. */
  async #thumbnailKey(
    document: DocumentRecord,
    shown: Shown,
  ): Promise<string | null> {
    try {
      const plan = await this.#deps.planner.plan(document, shown)
      if (plan.pending.length > 0 || plan.skipped.length > 0) return null
      return (await ensureRender(this.#deps, RenderKind.Thumbnail, plan)).key
    } catch (error) {
      this.#deps.logger.warn('A small picture could not be made', {
        documentId: document.id,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  async #shownFor(
    document: DocumentRecord,
    steps: ReadonlyArray<PlanStep>,
    index: number,
    inSubDocument: ReadonlyArray<LeafStep> | undefined,
  ): Promise<Shown | undefined> {
    const step = steps[index]
    if (step === undefined) {
      return inSubDocument === undefined ? undefined : { steps: inSubDocument }
    }
    if (isLayerStep(step)) return ownImage(step, document, this.#deps.planner)
    return { steps: steps.slice(0, index + 1) }
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
        const thumbnails: Array<{
          stepId: string
          key: string | null
          before?: true
        }> = []
        for (const [done, stepId] of payload.stepIds.entries()) {
          context.setProgress(done / payload.stepIds.length)
          const index = steps.findIndex((step) => step.id === stepId)
          const step = steps[index]
          const within = inside.get(stepId)
          const shown = await this.#shownFor(
            document,
            steps,
            index,
            within?.shown,
          )
          const on = step === undefined ? within?.enabled : step.enabled
          const key =
            shown === undefined || !on
              ? null
              : await this.#thumbnailKey(document, shown)
          thumbnails.push({ stepId, key })
        }
        for (const stepId of payload.beforeStepIds ?? []) {
          const ahead = stepsBefore(document.pipeline, stepId)
          const key =
            ahead === undefined
              ? null
              : await this.#thumbnailKey(document, { steps: ahead })
          thumbnails.push({ stepId, key, before: true })
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
