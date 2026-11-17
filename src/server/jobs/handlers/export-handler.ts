import path from 'node:path'

import { pipelineStepTitle } from '@/features/pipeline/step-problems'

import type { Logger } from '../../http/logger.ts'
import { actorForOwner } from '../../domain/system-actor.ts'
import { ValidationError } from '../../errors.ts'
import type { DocumentPlanner } from '../../render/document-planner.ts'
import type { ResultService } from '../../services/result-service.ts'
import { EngineTargetKind } from '../../tools/image-engine.ts'
import type { ImageEngine } from '../../tools/image-engine.ts'
import {
  fileNameForFormat,
  mediaTypeOfFormat,
} from '../../tools/image-formats.ts'
import { withWorkDirectory } from '../../tools/work-directory.ts'
import { ResultKind } from '../../dao/result-dao.ts'
import { WrongJobKindError, runEach } from '../job-handler.ts'
import type { JobHandler, JobItem, JobReport } from '../job-handler.ts'
import { JobKind, JobState } from '../job-types.ts'
import type { PipelinePlan } from '../../render/plan-pipeline.ts'
import { findStep } from '@/features/pipeline/pipeline'
import type { Pipeline } from '@/features/pipeline/pipeline'

export type ExportHandlerDependencies = {
  planner: DocumentPlanner
  engine: ImageEngine
  results: ResultService
  workRoot: string
  logger: Logger
}

const NOT_RENDERED = 'Run the AI steps before exporting.'

/** Refuses a plan that cannot make the whole image, saying which step is the problem. */
export function requireCompletePlan(
  plan: PipelinePlan,
  pipeline: Pipeline,
): void {
  if (plan.pending.length > 0) throw new ValidationError(NOT_RENDERED)
  const problem = plan.skipped.at(0)
  if (problem === undefined) return
  const step = findStep(pipeline, problem.stepId)?.step
  const label = step ? pipelineStepTitle(step) : 'A step'
  throw new ValidationError(`${label}: ${problem.message}`)
}

/**
 * Applies the whole Pipeline at full size and keeps the finished image as a
 * Result, so the User can download it (and download it again if that fails).
 */
export class ExportHandler implements JobHandler {
  readonly #deps: ExportHandlerDependencies

  constructor(deps: ExportHandlerDependencies) {
    this.#deps = deps
  }

  run(items: ReadonlyArray<JobItem>): Promise<ReadonlyArray<JobReport>> {
    return runEach(
      items,
      async ({ job, context }) => {
        const { payload } = job
        if (payload.kind !== JobKind.Export) throw new WrongJobKindError(job)
        const { planner, engine, results, workRoot } = this.#deps
        const document = await planner.loadForJob(
          job.ownerId,
          payload.documentId,
          payload.revision,
        )
        const plan = await planner.plan(document)
        requireCompletePlan(plan, document.pipeline)
        context.setProgress(0.1)
        const resultId = await withWorkDirectory(
          workRoot,
          async (directory) => {
            const output = path.join(directory, 'export')
            const info = await engine.render({
              input: plan.basePath,
              steps: plan.steps,
              target: {
                kind: EngineTargetKind.Export,
                settings: payload.settings,
                width: payload.width,
              },
              output,
            })
            const record = await results.record(actorForOwner(job.ownerId), {
              kind: ResultKind.Export,
              documentId: document.id,
              file: output,
              fileName: fileNameForFormat(document.name, info.format),
              mediaType: mediaTypeOfFormat(info.format),
            })
            return record.id
          },
        )
        return {
          outcome: {
            state: JobState.Done,
            result: { kind: JobKind.Export, resultId },
          },
        }
      },
      this.#deps.logger,
    )
  }
}
