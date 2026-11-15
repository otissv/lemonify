import { RenderKind } from '../../tools/render-store.ts'
import { WrongJobKindError, runEach } from '../job-handler.ts'
import type { JobHandler, JobItem, JobReport } from '../job-handler.ts'
import { JobKind, JobState } from '../job-types.ts'
import { ensureRender } from './preview-handler.ts'
import type { RenderHandlerDependencies } from './preview-handler.ts'

/**
 * Renders a small picture of the Document after each of the asked-for steps.
 * A step that is switched off, not set up, or after an AI step that has no
 * Result yet has no picture (its key is null).
 */
export class ThumbnailHandler implements JobHandler {
  readonly #deps: RenderHandlerDependencies

  constructor(deps: RenderHandlerDependencies) {
    this.#deps = deps
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
        const steps = document.pipeline.steps
        const thumbnails: Array<{ stepId: string; key: string | null }> = []
        for (const [done, stepId] of payload.stepIds.entries()) {
          context.setProgress(done / payload.stepIds.length)
          const index = steps.findIndex((step) => step.id === stepId)
          const step = steps[index]
          if (step === undefined || !step.enabled) {
            thumbnails.push({ stepId, key: null })
            continue
          }
          const plan = await planner.plan(document, {
            steps: steps.slice(0, index + 1),
          })
          if (plan.pending.length > 0 || plan.skipped.length > 0) {
            thumbnails.push({ stepId, key: null })
            continue
          }
          const key = await ensureRender(this.#deps, RenderKind.Thumbnail, plan)
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
