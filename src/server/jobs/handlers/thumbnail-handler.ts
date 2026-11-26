import type { PlanStep } from '@/features/pipeline/pipeline'
import { stepsBefore, stepsThrough } from '@/features/pipeline/step-input'
import type { Canvas, PictureSize } from '@/features/pipeline/canvas'
import { DEFAULT_LAYER_SETTINGS } from '@/features/pipeline/layer'
import { isLayerStep } from '@/features/pipeline/layer-kinds'
import type { LayerStep } from '@/features/pipeline/layer-kinds'

import type { DocumentRecord } from '../../dao/document-dao.ts'
import { RenderKind } from '../../tools/render-store.ts'
import { WrongJobKindError, runEach } from '../job-handler.ts'
import type { JobHandler, JobItem, JobReport } from '../job-handler.ts'
import { JobKind, JobState } from '../job-types.ts'
import { ensureRender } from './preview-handler.ts'
import type { RenderHandlerDependencies } from './preview-handler.ts'

/** What a small picture shows: steps on a canvas; the document's own canvas when none is given. */
type Shown = { steps: ReadonlyArray<PlanStep>; canvas?: Canvas }

/** One small picture, and the size in its own pixels of what it shows; a key of null has no picture and no size. */
type Thumbnail = {
  stepId: string
  key: string | null
  before?: true
  size?: PictureSize
}

type Made = Pick<Thumbnail, 'key' | 'size'>

const NOT_MADE: Made = { key: null }

/** A layer shows only what it draws, as it is, on a canvas of its own size: its image, or the document or workflow it uses. Undefined for a layer with nothing to show. */
async function ownImage(
  layer: LayerStep,
  document: DocumentRecord,
  planner: RenderHandlerDependencies['planner'],
): Promise<Shown | undefined> {
  const canvas = await planner.layerCanvas(document.ownerId, layer)
  if (canvas === undefined) return undefined
  return { steps: [{ ...layer, ...DEFAULT_LAYER_SETTINGS }], canvas }
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

  /** A small picture of `steps` and its true size, or none when they cannot make one, so one picture that fails does not take the others with it. A layer shows its own image. */
  async #thumbnail(document: DocumentRecord, shown: Shown): Promise<Made> {
    try {
      const plan = await this.#deps.planner.plan(document, shown)
      if (plan.pending.length > 0 || plan.skipped.length > 0) return NOT_MADE
      return await ensureRender(this.#deps, RenderKind.Thumbnail, plan)
    } catch (error) {
      this.#deps.logger.warn('A small picture could not be made', {
        documentId: document.id,
        error: error instanceof Error ? error.message : String(error),
      })
      return NOT_MADE
    }
  }

  /** What the small picture after a step shows: the picture it is drawn in up to and including it, or a layer's own image. Undefined when there is no such step. */
  async #shownFor(
    document: DocumentRecord,
    stepId: string,
  ): Promise<{ shown: Shown; on: boolean } | undefined> {
    const through = stepsThrough(document.pipeline, stepId)
    const step = through?.at(-1)
    if (through === undefined || step === undefined) return undefined
    if (!isLayerStep(step))
      return { shown: { steps: through }, on: step.enabled }
    const own = await ownImage(step, document, this.#deps.planner)
    return own === undefined ? undefined : { shown: own, on: step.enabled }
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
        const thumbnails: Thumbnail[] = []
        for (const [done, stepId] of payload.stepIds.entries()) {
          context.setProgress(done / payload.stepIds.length)
          const found = await this.#shownFor(document, stepId)
          const made =
            found === undefined || !found.on
              ? NOT_MADE
              : await this.#thumbnail(document, found.shown)
          thumbnails.push({ stepId, ...made })
        }
        for (const stepId of payload.beforeStepIds ?? []) {
          const ahead = stepsBefore(document.pipeline, stepId)
          const made =
            ahead === undefined
              ? NOT_MADE
              : await this.#thumbnail(document, { steps: ahead })
          thumbnails.push({ stepId, ...made, before: true })
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
