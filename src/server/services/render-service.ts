import type { Readable } from 'node:stream'

import { PipelineStepKind } from '@/features/pipeline/pipeline'
import { ExportSettingsSchema } from '@/features/export/export-settings'
import type { ExportSettings } from '@/features/export/export-settings'

import type { AiToolRegistry } from '../ai/ai-tool-registry.ts'
import type { DocumentDao, DocumentRecord } from '../dao/document-dao.ts'
import type { JobDao } from '../dao/job-dao.ts'
import { ResultKind } from '../dao/result-dao.ts'
import type { Actor } from '../domain/actor.ts'
import { isoNow } from '../domain/clock.ts'
import type { Clock } from '../domain/clock.ts'
import { requireOwned } from '../domain/ownership.ts'
import { ConflictError, NotFoundError, ValidationError } from '../errors.ts'
import { requireCompletePlan } from '../jobs/handlers/export-handler.ts'
import { JobKind } from '../jobs/job-types.ts'
import type { JobRecord } from '../jobs/job-types.ts'
import type { DocumentPlanner } from '../render/document-planner.ts'
import { exportFormatOptions } from '../tools/image-engine.ts'
import { RENDER_MEDIA_TYPE, type RenderKind } from '../tools/render-store.ts'
import type { RenderStore } from '../tools/render-store.ts'
import { RenderError } from '../tools/render-error.ts'
import type { JobService, JobView } from './job-service.ts'
import { toView } from './job-service.ts'
import type { ResultService } from './result-service.ts'
import { WorkerPool } from '@/features/ai/ai-tools'

const MISSING_DOCUMENT = 'That image does not exist.'
const MISSING_RENDER = 'That picture is not available. Request it again.'
const NOT_AN_AI_STEP = 'That step is not an AI step that is switched on.'
const ALREADY_RUN = 'This AI step has already been run.'
const EARLIER_FIRST = 'Run the earlier AI steps first.'
const NO_MAX = Number.MAX_SAFE_INTEGER

export type RenderServiceDependencies = {
  documents: DocumentDao
  planner: DocumentPlanner
  jobs: JobService
  jobDao: JobDao
  results: ResultService
  renders: RenderStore
  registry: AiToolRegistry
  clock: Clock
}

export type OpenedRender = {
  stream: Readable
  mediaType: string
}

export type ClearedResults = {
  removed: number
}

/**
 * Asks for pictures of a Document. Nothing here renders inline: every request
 * checks ownership, queues a Job and returns it, so a slow render never holds
 * a web request and the same rules apply to the website and the CLI.
 */
export class RenderService {
  readonly #deps: RenderServiceDependencies

  constructor(deps: RenderServiceDependencies) {
    this.#deps = deps
  }

  /**
   * Queues a preview of the Document as it is now. A newer request replaces
   * older ones for the same Document (latest wins); asking twice for the same
   * revision returns the Job already queued.
   */
  async requestPreview(actor: Actor, documentId: string): Promise<JobView> {
    const document = await this.#owned(actor, documentId)
    return this.#latestOnly(actor, document, JobKind.Preview, async () => [
      {
        kind: JobKind.Preview,
        payload: {
          kind: JobKind.Preview,
          documentId,
          revision: document.revision,
        },
        pool: WorkerPool.Cpu,
        groupKey: documentId,
        documentId,
      },
    ])
  }

  /** Queues small pictures for the given steps (all of them when none are given). */
  async requestThumbnails(
    actor: Actor,
    documentId: string,
    stepIds?: ReadonlyArray<string>,
  ): Promise<JobView> {
    const document = await this.#owned(actor, documentId)
    const ids = stepIds ?? document.pipeline.steps.map(({ id }) => id)
    return this.#latestOnly(actor, document, JobKind.Thumbnail, async () => [
      {
        kind: JobKind.Thumbnail,
        payload: {
          kind: JobKind.Thumbnail,
          documentId,
          revision: document.revision,
          stepIds: [...ids],
        },
        pool: WorkerPool.Cpu,
        groupKey: documentId,
        documentId,
      },
    ])
  }

  /** Queues an AI step to run; the earlier AI steps must have Results already. */
  async requestAiStep(
    actor: Actor,
    documentId: string,
    stepId: string,
  ): Promise<JobView> {
    const document = await this.#owned(actor, documentId)
    const step = document.pipeline.steps.find(({ id }) => id === stepId)
    if (step?.kind !== PipelineStepKind.Ai || !step.enabled) {
      throw new ValidationError(NOT_AN_AI_STEP)
    }
    const entry = this.#deps.registry.get(step.tool)
    const plan = await this.#deps.planner.plan(document)
    const first = plan.pending[0]
    if (first?.step.id !== step.id) {
      throw first === undefined
        ? new ConflictError(ALREADY_RUN)
        : new ValidationError(EARLIER_FIRST)
    }
    const active = await this.#activeJob(
      document,
      JobKind.AiStep,
      (job) =>
        job.payload.kind === JobKind.AiStep && job.payload.stepId === stepId,
    )
    if (active !== undefined) return toView(active)
    await this.#deps.results.assertWithinQuota(actor)
    const [queued] = await this.#deps.jobs.enqueue(actor, [
      {
        kind: JobKind.AiStep,
        payload: {
          kind: JobKind.AiStep,
          documentId,
          revision: document.revision,
          stepId,
          tool: step.tool,
          batchKey: entry.batchKey(step.settings),
        },
        pool: entry.summary.pool,
        groupKey: documentId,
        documentId,
      },
    ])
    return this.#only(queued)
  }

  /** Queues a full-size export. Refused now, not later, when it could not be made. */
  async requestExport(
    actor: Actor,
    documentId: string,
    settings: ExportSettings,
    width?: number,
  ): Promise<JobView> {
    const document = await this.#owned(actor, documentId)
    const checked = ExportSettingsSchema.safeParse(settings)
    if (!checked.success) {
      throw new ValidationError('The export settings are not valid.')
    }
    this.#checkOptions(checked.data)
    requireCompletePlan(
      await this.#deps.planner.plan(document),
      document.pipeline.steps,
    )
    await this.#deps.results.assertWithinQuota(actor)
    const [queued] = await this.#deps.jobs.enqueue(actor, [
      {
        kind: JobKind.Export,
        payload: {
          kind: JobKind.Export,
          documentId,
          revision: document.revision,
          settings: checked.data,
          width,
        },
        pool: WorkerPool.Cpu,
        groupKey: documentId,
        documentId,
      },
    ])
    return this.#only(queued)
  }

  /** A stored preview or thumbnail, for serving. */
  async fetch(
    actor: Actor,
    documentId: string,
    kind: RenderKind,
    key: string,
  ): Promise<OpenedRender> {
    await this.#owned(actor, documentId)
    const { renders } = this.#deps
    let found: string | undefined
    try {
      found = await renders.find(kind, key)
    } catch (error) {
      if (error instanceof TypeError) throw new NotFoundError(MISSING_RENDER)
      throw error
    }
    if (found === undefined) throw new NotFoundError(MISSING_RENDER)
    return { stream: renders.open(kind, key), mediaType: RENDER_MEDIA_TYPE }
  }

  /**
   * Deletes the AI Results the Document's current Pipeline no longer uses.
   * Undo may bring a step back, and that step then has to run again.
   * Exports are never touched: they are deliveries, not working images.
   */
  async clearUnusedResults(
    actor: Actor,
    documentId: string,
  ): Promise<ClearedResults> {
    const document = await this.#owned(actor, documentId)
    const plan = await this.#deps.planner.plan(document, {
      assumeAiResults: true,
    })
    const used = new Set(plan.aiKeys.values())
    const stored = await this.#deps.results.list(actor, {
      documentId,
      kind: ResultKind.AiStep,
    })
    let removed = 0
    for (const result of stored) {
      if (used.has(result.key)) continue
      await this.#deps.results.delete(actor, result.id)
      removed += 1
    }
    return { removed }
  }

  async #owned(actor: Actor, documentId: string): Promise<DocumentRecord> {
    return requireOwned(
      actor,
      await this.#deps.documents.findById(documentId),
      MISSING_DOCUMENT,
    )
  }

  #checkOptions(settings: ExportSettings): void {
    try {
      exportFormatOptions(settings)
    } catch (error) {
      if (error instanceof RenderError) throw new ValidationError(error.message)
      throw error
    }
  }

  async #activeJob(
    document: DocumentRecord,
    kind: JobKind,
    matches: (job: JobRecord) => boolean,
  ): Promise<JobRecord | undefined> {
    const active = await this.#deps.jobDao.listActive({
      documentId: document.id,
      kinds: [kind],
    })
    return active.find(
      (job) =>
        matches(job) &&
        'revision' in job.payload &&
        job.payload.revision === document.revision,
    )
  }

  /** Cancels this kind of Job for older revisions of the Document, then queues a new one unless one is already queued for this revision. */
  async #latestOnly(
    actor: Actor,
    document: DocumentRecord,
    kind: JobKind,
    build: () => Promise<Parameters<JobService['enqueue']>[1]>,
  ): Promise<JobView> {
    const { jobDao, clock, jobs } = this.#deps
    const active = await jobDao.listActive({
      documentId: document.id,
      kinds: [kind],
    })
    let current: JobRecord | undefined
    for (const job of active) {
      const revision = 'revision' in job.payload ? job.payload.revision : NO_MAX
      if (revision === document.revision) current ??= job
      else await jobDao.requestCancel(job.id, isoNow(clock))
    }
    if (current !== undefined) return toView(current)
    const [queued] = await jobs.enqueue(actor, await build())
    return this.#only(queued)
  }

  #only(job: JobRecord | undefined): JobView {
    if (job === undefined) throw new Error('A job was not queued.')
    return toView(job)
  }
}
