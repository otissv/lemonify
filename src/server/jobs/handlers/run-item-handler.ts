import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { outputFileNames } from '@/features/workflows/output-settings'
import type { Pipeline } from '@/features/pipeline/pipeline'
import { itemPipeline, planSegments } from '@/features/workflows/segments'
import type {
  AiSegment,
  DrawSegment,
  Segment,
} from '@/features/workflows/segments'

import type { AiToolRegistry } from '../../ai/ai-tool-registry.ts'
import { ResultKind } from '../../dao/result-dao.ts'
import type { SourceDao, SourceRecord } from '../../dao/source-dao.ts'
import type { WorkflowDao, WorkflowRunRecord } from '../../dao/workflow-dao.ts'
import { actorForOwner } from '../../domain/system-actor.ts'
import { ValidationError } from '../../errors.ts'
import type { Logger } from '../../http/logger.ts'
import { planPipeline } from '../../render/plan-pipeline.ts'
import type { PlanLookups } from '../../render/plan-pipeline.ts'
import type { ResultService } from '../../services/result-service.ts'
import type { JobService } from '../../services/job-service.ts'
import { EngineTargetKind } from '../../tools/image-engine.ts'
import type {
  EngineBase,
  EngineStep,
  ImageEngine,
} from '../../tools/image-engine.ts'
import {
  fileNameForFormat,
  mediaTypeOfFormat,
} from '../../tools/image-formats.ts'
import type { SourceStore } from '../../tools/source-store.ts'
import { runWorkDirectory, segmentJobSpec } from '../../workflows/run-jobs.ts'
import { outcomeOfError } from '../job-failure.ts'
import { StaleJobError, WrongJobKindError } from '../job-handler.ts'
import type { JobHandler, JobItem, JobReport } from '../job-handler.ts'
import { JobKind, JobState } from '../job-types.ts'
import type { JobRecord } from '../job-types.ts'
import { runAiBatch } from './ai-batch.ts'
import type { AiBatchEntry } from './ai-batch.ts'

export type RunItemHandlerDependencies = {
  workflows: WorkflowDao
  sources: SourceDao
  sourceStore: SourceStore
  engine: ImageEngine
  registry: AiToolRegistry
  results: ResultService
  jobs: JobService
  /** Where the run's work images go; the run's own folder is made under it. */
  workRoot: string
  logger: Logger
}

type Loaded = {
  job: JobRecord
  run: WorkflowRunRecord
  /** The pipeline this input image runs through: the workflow's, with the image in its first slot. */
  pipeline: Pipeline
  segments: Segment[]
  /** Which of the run's segments this Job runs. */
  index: number
  segment: Segment
  source: SourceRecord
  /** The work image the previous segment left; absent on the first segment. */
  input: string | undefined
  output: string
}

const MISSING_SOURCE = 'An image in this workflow no longer exists.'
const NO_SEGMENT = 'This workflow run has no such step.'

const NO_WORK_IMAGE = 'This workflow run lost the image it was working on.'
const NOT_DRAWN = 'A step of this workflow could not be applied.'

/**
 * Runs one segment of a workflow run on one Source. A segment that is not
 * the last leaves a work image and queues the next segment's Job in the same
 * transaction that finishes this one; the last writes the finished images as
 * Results. AI segments with the same tool and settings arrive together and
 * run as one GPU batch.
 */
export class RunItemHandler implements JobHandler {
  readonly #deps: RunItemHandlerDependencies

  constructor(deps: RunItemHandlerDependencies) {
    this.#deps = deps
  }

  async run(items: ReadonlyArray<JobItem>): Promise<ReadonlyArray<JobReport>> {
    const reports = new Map<JobItem, JobReport>()
    const aiEntries: Array<{ loaded: Loaded; item: JobItem }> = []
    for (const item of items) {
      try {
        const loaded = await this.#load(item)
        if (loaded.segment.kind === 'ai') aiEntries.push({ loaded, item })
        else
          reports.set(item, await this.#runDraw(loaded, loaded.segment, item))
      } catch (error) {
        this.#log(error, item)
        reports.set(item, { outcome: outcomeOfError(error) })
      }
    }
    if (aiEntries.length > 0) await this.#runAi(aiEntries, reports)
    return items.map(
      (item) => reports.get(item) ?? { outcome: { state: JobState.Cancelled } },
    )
  }

  #log(error: unknown, item: JobItem): void {
    if (error instanceof StaleJobError) return
    this.#deps.logger.error('A workflow job failed', {
      jobId: item.job.id,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  async #load({ job }: JobItem): Promise<Loaded> {
    const { workflows, sources, workRoot } = this.#deps
    const { payload } = job
    if (payload.kind !== JobKind.RunItem) throw new WrongJobKindError(job)
    const run = await workflows.findRun(payload.workflowRunId)
    if (run === null || run.ownerId !== job.ownerId) throw new StaleJobError()
    const source = await sources.findById(payload.sourceId)
    if (source === null || source.ownerId !== job.ownerId) {
      throw new ValidationError(MISSING_SOURCE)
    }
    const pipeline = itemPipeline(run.definition, run.canvasMode, source)
    const segments = planSegments(pipeline)
    const segment = segments[payload.segment]
    if (segment === undefined) throw new ValidationError(NO_SEGMENT)
    const directory = runWorkDirectory(workRoot, run.id)
    await mkdir(directory, { recursive: true })
    return {
      job,
      run,
      pipeline,
      segments,
      index: payload.segment,
      segment,
      source,
      input: payload.input,
      output: path.join(directory, `${source.id}-${payload.segment}.png`),
    }
  }

  async #lookups(ownerId: string): Promise<PlanLookups> {
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

  /** What the engine does in a draw segment: the work image the last AI step left, or the blank canvas, with the segment's steps on it. */
  async #planDraw(loaded: Loaded, segment: DrawSegment) {
    const plan = await planPipeline(
      loaded.pipeline.canvas,
      segment.steps,
      await this.#lookups(loaded.job.ownerId),
    )
    const [problem] = plan.skipped
    if (problem !== undefined) {
      throw new ValidationError(problem.message || NOT_DRAWN)
    }
    const base: EngineBase =
      loaded.input === undefined
        ? plan.base
        : { kind: 'file', path: loaded.input }
    return { base, steps: plan.steps }
  }

  async #runDraw(
    loaded: Loaded,
    segment: DrawSegment,
    item: JobItem,
  ): Promise<JobReport> {
    const { engine, results, jobs } = this.#deps
    const { job, run, segments, source, index } = loaded
    const { base, steps } = await this.#planDraw(loaded, segment)
    if (index < segments.length - 1) {
      await engine.render({
        input: base,
        steps,
        target: { kind: EngineTargetKind.Intermediate },
        output: loaded.output,
      })
      item.context.setProgress(1)
      const next = jobs.build(actorForOwner(job.ownerId), [
        segmentJobSpec({
          runId: run.id,
          segments,
          index: index + 1,
          sourceId: source.id,
          input: loaded.output,
          registry: this.#deps.registry,
        }),
      ])
      return {
        outcome: {
          state: JobState.Done,
          result: { kind: JobKind.RunItem, resultIds: [] },
        },
        next,
      }
    }
    const resultIds = await this.#writeOutputs(
      loaded,
      { base, steps },
      item,
      results,
    )
    return {
      outcome: {
        state: JobState.Done,
        result: { kind: JobKind.RunItem, resultIds },
      },
    }
  }

  async #writeOutputs(
    loaded: Loaded,
    drawn: { base: EngineBase; steps: ReadonlyArray<EngineStep> },
    item: JobItem,
    results: ResultService,
  ): Promise<string[]> {
    const { engine, sourceStore } = this.#deps
    const { job, run, source } = loaded
    const settings = run.definition.output
    const names = outputFileNames(source.fileName, settings)
    const widths: Array<number | undefined> =
      settings.widths.length > 0 ? [...settings.widths] : [undefined]
    const resultIds: string[] = []
    for (const [index, width] of widths.entries()) {
      const file = path.join(
        path.dirname(loaded.output),
        `${source.id}-out-${index}`,
      )
      const info = await engine.render({
        input: drawn.base,
        originalFrom: sourceStore.pathOf(source.contentHash),
        steps: drawn.steps,
        target: {
          kind: EngineTargetKind.Export,
          settings: {
            format: settings.format,
            options: settings.options,
            keepMetadata: settings.keepMetadata,
          },
          width,
        },
        output: file,
      })
      const record = await results.record(actorForOwner(job.ownerId), {
        kind: ResultKind.RunItem,
        workflowRunId: run.id,
        file,
        fileName: fileNameForFormat(
          names[index] ?? source.fileName,
          info.format,
        ),
        mediaType: mediaTypeOfFormat(info.format),
      })
      resultIds.push(record.id)
      item.context.setProgress((index + 1) / widths.length)
    }
    return resultIds
  }

  async #runAi(
    entries: ReadonlyArray<{ loaded: Loaded; item: JobItem }>,
    reports: Map<JobItem, JobReport>,
  ): Promise<void> {
    const groups = new Map<string, Array<{ loaded: Loaded; item: JobItem }>>()
    for (const entry of entries) {
      const key =
        entry.item.job.payload.kind === JobKind.RunItem
          ? (entry.item.job.payload.batchKey ?? entry.item.job.id)
          : entry.item.job.id
      const group = groups.get(key)
      if (group) group.push(entry)
      else groups.set(key, [entry])
    }
    for (const group of groups.values()) await this.#runAiGroup(group, reports)
  }

  async #runAiGroup(
    group: ReadonlyArray<{ loaded: Loaded; item: JobItem }>,
    reports: Map<JobItem, JobReport>,
  ): Promise<void> {
    const first = group[0]
    if (first === undefined || first.loaded.segment.kind !== 'ai') return
    const segment: AiSegment = first.loaded.segment
    const batch: AiBatchEntry[] = []
    for (const { loaded, item } of group) {
      if (loaded.input === undefined) throw new ValidationError(NO_WORK_IMAGE)
      batch.push({ item, input: loaded.input, output: loaded.output })
    }
    try {
      await runAiBatch(
        this.#deps.registry,
        segment.step.tool,
        segment.step.settings,
        batch,
      )
    } catch (error) {
      for (const { item } of group) this.#log(error, item)
      const outcome = outcomeOfError(error)
      for (const { item } of group) reports.set(item, { outcome })
      return
    }
    for (const { loaded, item } of group) {
      if (item.context.signal.aborted) {
        reports.set(item, { outcome: { state: JobState.Cancelled } })
        continue
      }
      const { job, run, segments, source, index } = loaded
      const next = this.#deps.jobs.build(actorForOwner(job.ownerId), [
        segmentJobSpec({
          runId: run.id,
          segments,
          index: index + 1,
          sourceId: source.id,
          input: loaded.output,
          registry: this.#deps.registry,
        }),
      ])
      reports.set(item, {
        outcome: {
          state: JobState.Done,
          result: { kind: JobKind.RunItem, resultIds: [] },
        },
        next,
      })
    }
  }
}
