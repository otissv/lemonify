import { stepsBefore, stepsThrough } from '@/features/pipeline/step-input'

import type { PlanStep } from '@/features/pipeline/pipeline'
import type { DocumentRecord } from '../../dao/document-dao.ts'
import type { Logger } from '../../http/logger.ts'
import type { DocumentPlanner } from '../../render/document-planner.ts'
import { planKey } from '../../render/plan-pipeline.ts'
import type { PipelinePlan } from '../../render/plan-pipeline.ts'
import { EngineTargetKind } from '../../tools/image-engine.ts'
import type { ImageEngine } from '../../tools/image-engine.ts'
import { RenderKind } from '../../tools/render-store.ts'
import type { RenderSize, RenderStore } from '../../tools/render-store.ts'
import { WrongJobKindError, runEach } from '../job-handler.ts'
import type { JobHandler, JobItem, JobReport } from '../job-handler.ts'
import { JobKind, JobState } from '../job-types.ts'

export type RenderHandlerDependencies = {
  planner: DocumentPlanner
  renders: RenderStore
  engine: ImageEngine
  logger: Logger
}

export interface EnsuredRender {
  key: string
  /** The size of the picture the render shows, in its own pixels, before it was shrunk. */
  size: RenderSize
}

/**
 * Makes the Render of a plan, or finds it in the cache. Shared by previews and
 * thumbnails, which differ only in size. A cached render whose size was not
 * kept is made again, so the size is always known.
 */
export async function ensureRender(
  deps: RenderHandlerDependencies,
  kind: RenderKind,
  plan: PipelinePlan,
): Promise<EnsuredRender> {
  const key = planKey(plan)
  if ((await deps.renders.find(kind, key)) !== undefined) {
    const size = await deps.renders.size(kind, key)
    if (size !== undefined) return { key, size }
  }
  const target = await deps.renders.reserve(kind, key)
  try {
    const output = await deps.engine.render({
      input: plan.base,
      originalFrom: plan.originalFrom,
      steps: plan.steps,
      target: {
        kind:
          kind === RenderKind.Preview
            ? EngineTargetKind.Preview
            : kind === RenderKind.WorkflowNode
              ? EngineTargetKind.WorkflowNode
              : EngineTargetKind.Thumbnail,
      },
      output: target.partial,
    })
    const size = { width: output.pictureWidth, height: output.pictureHeight }
    await deps.renders.commit(target, size)
    return { key, size }
  } catch (error) {
    await deps.renders.discard(target)
    throw error
  }
}

function shownSteps(
  pipeline: DocumentRecord['pipeline'],
  payload: { beforeStepId?: string; throughStepId?: string },
): ReadonlyArray<PlanStep> | undefined {
  const { beforeStepId, throughStepId } = payload
  if (beforeStepId !== undefined) {
    const steps = stepsBefore(pipeline, beforeStepId)
    if (steps === undefined) throw new StepGoneError(beforeStepId)
    return steps
  }
  if (throughStepId === undefined) return undefined
  const steps = stepsThrough(pipeline, throughStepId)
  if (steps === undefined) throw new StepGoneError(throughStepId)
  return steps
}

class StepGoneError extends Error {
  constructor(stepId: string) {
    super(`The step ${stepId} is no longer in the document.`)
    this.name = 'StepGoneError'
  }
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
        const steps = shownSteps(document.pipeline, payload)
        const whole = await this.#deps.planner.plan(document)
        const plan =
          steps === undefined
            ? whole
            : await this.#deps.planner.plan(document, { steps })
        const { key, size } = await ensureRender(
          this.#deps,
          RenderKind.Preview,
          plan,
        )
        return {
          outcome: {
            state: JobState.Done,
            result: {
              kind: JobKind.Preview,
              key,
              width: size.width,
              height: size.height,
              pendingStepIds: whole.pending.map(({ step }) => step.id),
              problems: [...whole.skipped],
            },
          },
        }
      },
      this.#deps.logger,
    )
  }
}
