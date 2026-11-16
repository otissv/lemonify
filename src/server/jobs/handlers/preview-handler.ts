import type { Logger } from '../../http/logger.ts'
import type { DocumentPlanner } from '../../render/document-planner.ts'
import { planKey } from '../../render/plan-pipeline.ts'
import type { PipelinePlan } from '../../render/plan-pipeline.ts'
import { EngineTargetKind } from '../../tools/image-engine.ts'
import type { ImageEngine } from '../../tools/image-engine.ts'
import { RenderKind } from '../../tools/render-store.ts'
import type { RenderStore } from '../../tools/render-store.ts'
import { WrongJobKindError, runEach } from '../job-handler.ts'
import type { JobHandler, JobItem, JobReport } from '../job-handler.ts'
import { JobKind, JobState } from '../job-types.ts'

export type RenderHandlerDependencies = {
  planner: DocumentPlanner
  renders: RenderStore
  engine: ImageEngine
  logger: Logger
}

/**
 * Makes the Render of a plan, or finds it in the cache. Shared by previews and
 * thumbnails, which differ only in size.
 */
export async function ensureRender(
  deps: RenderHandlerDependencies,
  kind: RenderKind,
  plan: PipelinePlan,
): Promise<string> {
  const key = planKey(plan)
  if ((await deps.renders.find(kind, key)) !== undefined) return key
  const target = await deps.renders.reserve(kind, key)
  try {
    await deps.engine.render({
      input: plan.basePath,
      steps: plan.steps,
      target: {
        kind:
          kind === RenderKind.Preview
            ? EngineTargetKind.Preview
            : EngineTargetKind.Thumbnail,
      },
      output: target.partial,
    })
    await deps.renders.commit(target)
  } catch (error) {
    await deps.renders.discard(target)
    throw error
  }
  return key
}

/** Renders a Document's Pipeline at display size, as it stands at the Job's revision. */
export class PreviewHandler implements JobHandler {
  readonly #deps: RenderHandlerDependencies

  constructor(deps: RenderHandlerDependencies) {
    this.#deps = deps
  }

  run(items: ReadonlyArray<JobItem>): Promise<ReadonlyArray<JobReport>> {
    return runEach(
      items,
      async ({ job }) => {
        const { payload } = job
        if (payload.kind !== JobKind.Preview) throw new WrongJobKindError(job)
        const document = await this.#deps.planner.loadForJob(
          job.ownerId,
          payload.documentId,
          payload.revision,
        )
        const plan = await this.#deps.planner.plan(document)
        const key = await ensureRender(this.#deps, RenderKind.Preview, plan)
        return {
          outcome: {
            state: JobState.Done,
            result: {
              kind: JobKind.Preview,
              key,
              pendingStepIds: plan.pending.map(({ step }) => step.id),
              problems: [...plan.skipped],
            },
          },
        }
      },
      this.#deps.logger,
    )
  }
}
