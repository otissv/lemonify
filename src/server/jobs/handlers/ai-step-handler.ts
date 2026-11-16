import path from 'node:path'

import type { AiToolId } from '@/features/ai/ai-tools'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { AiStep } from '@/features/pipeline/pipeline'

import type { AiToolRegistry } from '../../ai/ai-tool-registry.ts'
import { ResultKind } from '../../dao/result-dao.ts'
import type { DocumentRecord } from '../../dao/document-dao.ts'
import { actorForOwner } from '../../domain/system-actor.ts'
import { ValidationError } from '../../errors.ts'
import type { Logger } from '../../http/logger.ts'
import type { DocumentPlanner } from '../../render/document-planner.ts'
import type { ResultService } from '../../services/result-service.ts'
import { EngineTargetKind } from '../../tools/image-engine.ts'
import type { ImageEngine } from '../../tools/image-engine.ts'
import { fileNameForFormat } from '../../tools/image-formats.ts'
import { withWorkDirectory } from '../../tools/work-directory.ts'
import { outcomeOfError } from '../job-failure.ts'
import { runAiBatch } from './ai-batch.ts'
import { WrongJobKindError } from '../job-handler.ts'
import type { JobHandler, JobItem, JobReport } from '../job-handler.ts'
import { JobKind, JobState } from '../job-types.ts'

export type AiStepHandlerDependencies = {
  planner: DocumentPlanner
  /** Applies the Sharp steps that come before an AI step. */
  engine: ImageEngine
  registry: AiToolRegistry
  results: ResultService
  workRoot: string
  logger: Logger
}

type Ready = {
  item: JobItem
  document: DocumentRecord
  step: AiStep
  tool: AiToolId
  batchKey: string
  key: string
  input: string
  output: string
}

const NOT_AN_AI_STEP = 'That step is no longer an AI step that can run.'
const EARLIER_FIRST = 'Run the earlier AI steps first.'
const PROGRESS_AFTER_PREPARING = 0.05

function done(resultId: string): JobReport {
  return {
    outcome: {
      state: JobState.Done,
      result: { kind: JobKind.AiStep, resultId },
    },
  }
}

/**
 * Runs an AI step on the picture as it stands after the Sharp steps
 * before it, and keeps the output as a Result under the step's key. Jobs
 * that share a batch key arrive together and go to the engine as one batch, so
 * the model loads once.
 */
export class AiStepHandler implements JobHandler {
  readonly #deps: AiStepHandlerDependencies

  constructor(deps: AiStepHandlerDependencies) {
    this.#deps = deps
  }

  async run(items: ReadonlyArray<JobItem>): Promise<ReadonlyArray<JobReport>> {
    const reports = new Map<JobItem, JobReport>()
    await withWorkDirectory(this.#deps.workRoot, async (directory) => {
      const ready: Ready[] = []
      for (const item of items) {
        try {
          const prepared = await this.#prepare(item, directory)
          if ('resultId' in prepared) reports.set(item, done(prepared.resultId))
          else ready.push(prepared)
        } catch (error) {
          reports.set(item, { outcome: outcomeOfError(error) })
        }
      }
      for (const group of groupByBatch(ready)) {
        await this.#runGroup(group, reports)
      }
    })
    return items.map(
      (item) => reports.get(item) ?? { outcome: { state: JobState.Cancelled } },
    )
  }

  async #prepare(
    item: JobItem,
    directory: string,
  ): Promise<Ready | { resultId: string }> {
    const { planner, results, engine } = this.#deps
    const { job } = item
    const { payload } = job
    if (payload.kind !== JobKind.AiStep) throw new WrongJobKindError(job)
    const document = await planner.loadForJob(
      job.ownerId,
      payload.documentId,
      payload.revision,
    )
    const step = document.pipeline.steps.find(({ id }) => id === payload.stepId)
    if (step?.kind !== PipelineStepKind.Ai || !step.enabled) {
      throw new ValidationError(NOT_AN_AI_STEP)
    }
    const plan = await planner.plan(document)
    const key = plan.aiKeys.get(step.id)
    if (key === undefined) throw new ValidationError(NOT_AN_AI_STEP)
    const existing = await results.find(job.ownerId, key)
    if (existing !== undefined) return { resultId: existing.id }
    if (plan.pending[0]?.step.id !== step.id) {
      throw new ValidationError(EARLIER_FIRST)
    }
    let input = plan.basePath
    if (plan.steps.length > 0) {
      input = path.join(directory, `in-${job.id}.png`)
      await engine.render({
        input: plan.basePath,
        steps: plan.steps,
        target: { kind: EngineTargetKind.Intermediate },
        output: input,
      })
    }
    item.context.setProgress(PROGRESS_AFTER_PREPARING)
    return {
      item,
      document,
      step,
      tool: payload.tool,
      batchKey: payload.batchKey,
      key,
      input,
      output: path.join(directory, `out-${job.id}.png`),
    }
  }

  async #runGroup(
    group: ReadonlyArray<Ready>,
    reports: Map<JobItem, JobReport>,
  ): Promise<void> {
    const [first] = group
    if (first === undefined) return
    const { registry, results, logger } = this.#deps
    try {
      await runAiBatch(
        registry,
        first.tool,
        first.step.settings,
        group.map(({ item, input, output }) => ({ item, input, output })),
      )
    } catch (error) {
      const outcome = outcomeOfError(error)
      if (outcome.state === JobState.Failed) {
        logger.error('An AI step failed', {
          jobIds: group.map(({ item }) => item.job.id).join(','),
          detail: error instanceof Error ? error.message : String(error),
        })
      }
      for (const { item } of group) reports.set(item, { outcome })
      return
    }
    for (const entry of group) {
      try {
        reports.set(entry.item, await this.#record(entry, results))
      } catch (error) {
        reports.set(entry.item, { outcome: outcomeOfError(error) })
      }
    }
  }

  async #record(entry: Ready, results: ResultService): Promise<JobReport> {
    const { item, document, tool, key, output } = entry
    if (item.context.signal.aborted) {
      return { outcome: { state: JobState.Cancelled } }
    }
    const record = await results.record(actorForOwner(item.job.ownerId), {
      kind: ResultKind.AiStep,
      key,
      documentId: document.id,
      stepId: entry.step.id,
      file: output,
      fileName: fileNameForFormat(`${document.name}-${tool}`, 'png'),
      mediaType: 'image/png',
    })
    return done(record.id)
  }
}

function groupByBatch(ready: ReadonlyArray<Ready>): Ready[][] {
  const groups = new Map<string, Ready[]>()
  for (const entry of ready) {
    const group = groups.get(entry.batchKey)
    if (group) group.push(entry)
    else groups.set(entry.batchKey, [entry])
  }
  return [...groups.values()]
}
