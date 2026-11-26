import type { Readable } from 'node:stream'

import { PipelineStepKind, isContainerStep } from '@/features/pipeline/pipeline'
import type { Pipeline } from '@/features/pipeline/pipeline'
import { stepsBefore, stepsThrough } from '@/features/pipeline/step-input'
import { ExportSettingsSchema } from '@/features/export/export-settings'
import type {
  ExportFormat,
  ExportSettings,
} from '@/features/export/export-settings'
import { writableExportFormats } from '@/features/export/server/export-formats'

import type { AiToolRegistry } from '../ai/ai-tool-registry.ts'
import type { DocumentDao, DocumentRecord } from '../dao/document-dao.ts'
import type { WorkflowDao, WorkflowRecord } from '../dao/workflow-dao.ts'
import { workflowPreviewNodeIds } from '@/features/workflows/workflow-graph-layout'
import type { JobDao } from '../dao/job-dao.ts'
import { ResultKind } from '../dao/result-dao.ts'
import type { Actor } from '../domain/actor.ts'
import { isoNow } from '../domain/clock.ts'
import type { Clock } from '../domain/clock.ts'
import { requireOwned } from '../domain/ownership.ts'
import { ConflictError, NotFoundError, ValidationError } from '../errors.ts'
import { requireCompletePlan } from '../jobs/handlers/export-handler.ts'
import { JobKind } from '../jobs/job-types.ts'
import type { JobPayload, JobRecord } from '../jobs/job-types.ts'
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
const MISSING_WORKFLOW = 'That workflow does not exist.'
const MISSING_RENDER = 'That picture is not available. Request it again.'
/** Every step that does work, and each embedded document layer, which has a picture of its own to show, at any depth. */
function thumbnailStepIds(steps: Pipeline['steps']): string[] {
  return steps.flatMap((step) => {
    if (!isContainerStep(step)) return [step.id]
    const inner = thumbnailStepIds(step.steps)
    return step.kind === PipelineStepKind.EmbeddedDocument
      ? [step.id, ...inner]
      : inner
  })
}

const ONE_STEP_VIEW =
  'Ask for the picture before a step or through it, not both.'
const NO_SUCH_STEP = 'The document has no such step.'
const NO_SUCH_NODE = 'The workflow has no such node.'
const NOT_AN_AI_STEP = 'That step is not an AI step that is switched on.'
const ALREADY_RUN = 'This AI step has already been run.'
const EARLIER_FIRST = 'Run the earlier AI steps first.'
const NO_MAX = Number.MAX_SAFE_INTEGER

export type PreviewOptions = {
  /** Show the picture this step acts on instead of the whole Pipeline. */
  beforeStepId?: string
  /** Show the picture this step leaves, with the steps after it left out. Not together with `beforeStepId`. */
  throughStepId?: string
}

export type ThumbnailOptions = {
  stepIds?: ReadonlyArray<string>
  beforeStepIds?: ReadonlyArray<string>
}

export type RenderServiceDependencies = {
  documents: DocumentDao
  workflows: WorkflowDao
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
   * Queues a preview of the Document as it is now, or of the picture a step
   * acts on when `beforeStepId` is given. A newer request replaces older ones
   * for the same Document (latest wins); asking twice for the same revision and
   * step returns the Job already queued.
   */
  async requestPreview(
    actor: Actor,
    documentId: string,
    options: PreviewOptions = {},
  ): Promise<JobView> {
    const document = await this.#owned(actor, documentId)
    const { beforeStepId, throughStepId } = options
    if (beforeStepId !== undefined && throughStepId !== undefined) {
      throw new ValidationError(ONE_STEP_VIEW)
    }
    if (
      (beforeStepId !== undefined &&
        stepsBefore(document.pipeline, beforeStepId) === undefined) ||
      (throughStepId !== undefined &&
        stepsThrough(document.pipeline, throughStepId) === undefined)
    ) {
      throw new ValidationError(NO_SUCH_STEP)
    }
    return this.#latestOnly(
      actor,
      document,
      JobKind.Preview,
      async () => [
        {
          kind: JobKind.Preview,
          payload: {
            kind: JobKind.Preview,
            documentId,
            revision: document.revision,
            ...(beforeStepId === undefined ? {} : { beforeStepId }),
            ...(throughStepId === undefined ? {} : { throughStepId }),
          },
          pool: WorkerPool.Cpu,
          groupKey: documentId,
          documentId,
        },
      ],
      (payload) =>
        payload.kind === JobKind.Preview &&
        payload.beforeStepId === beforeStepId &&
        payload.throughStepId === throughStepId,
    )
  }

  /**
   * Queues small pictures: one after each of `stepIds` (all of the steps when
   * none are given) and one before each of `beforeStepIds`, which is what the
   * step acts on.
   */
  async requestThumbnails(
    actor: Actor,
    documentId: string,
    options: ThumbnailOptions = {},
  ): Promise<JobView> {
    const document = await this.#owned(actor, documentId)
    const ids = options.stepIds ?? thumbnailStepIds(document.pipeline.steps)
    const beforeIds = options.beforeStepIds ?? []
    for (const id of beforeIds) {
      if (stepsBefore(document.pipeline, id) === undefined) {
        throw new ValidationError(NO_SUCH_STEP)
      }
    }
    return this.#latestOnly(actor, document, JobKind.Thumbnail, async () => [
      {
        kind: JobKind.Thumbnail,
        payload: {
          kind: JobKind.Thumbnail,
          documentId,
          revision: document.revision,
          stepIds: [...ids],
          ...(beforeIds.length === 0 ? {} : { beforeStepIds: [...beforeIds] }),
        },
        pool: WorkerPool.Cpu,
        groupKey: documentId,
        documentId,
      },
    ])
  }

  /** Queues small pictures under each node of a workflow diagram. */
  async requestWorkflowThumbnails(
    actor: Actor,
    workflowId: string,
    nodeIds?: ReadonlyArray<string>,
  ): Promise<JobView> {
    const workflow = await this.#ownedWorkflow(actor, workflowId)
    const ids =
      nodeIds ??
      workflowPreviewNodeIds({
        id: workflow.id,
        name: workflow.name,
        ...workflow.definition,
      })
    return this.#latestOnlyWorkflow(
      actor,
      workflow,
      JobKind.WorkflowThumbnail,
      async () => [
        {
          kind: JobKind.WorkflowThumbnail,
          payload: {
            kind: JobKind.WorkflowThumbnail,
            workflowId,
            revision: workflow.revision,
            nodeIds: [...ids],
          },
          pool: WorkerPool.Cpu,
          groupKey: workflowId,
        },
      ],
    )
  }

  /**
   * Queues the large picture of one workflow diagram node: a step, or the
   * canvas, inputs or output. A newer request for another node or revision
   * replaces older ones (latest wins); asking again for the same node returns
   * the Job already queued.
   */
  async requestWorkflowPreview(
    actor: Actor,
    workflowId: string,
    nodeId: string,
  ): Promise<JobView> {
    const workflow = await this.#ownedWorkflow(actor, workflowId)
    const nodeIds = workflowPreviewNodeIds({
      id: workflow.id,
      name: workflow.name,
      ...workflow.definition,
    })
    if (!nodeIds.includes(nodeId)) throw new ValidationError(NO_SUCH_NODE)
    return this.#latestOnlyWorkflow(
      actor,
      workflow,
      JobKind.WorkflowPreview,
      async () => [
        {
          kind: JobKind.WorkflowPreview,
          payload: {
            kind: JobKind.WorkflowPreview,
            workflowId,
            revision: workflow.revision,
            nodeId,
          },
          pool: WorkerPool.Cpu,
          groupKey: workflowId,
        },
      ],
      (payload) =>
        payload.kind === JobKind.WorkflowPreview && payload.nodeId === nodeId,
    )
  }

  /** Queues an AI step to run; the earlier AI steps must have Results already. */
  async requestAiStep(
    actor: Actor,
    documentId: string,
    stepId: string,
  ): Promise<JobView> {
    const document = await this.#owned(actor, documentId)
    const plan = await this.#deps.planner.plan(document)
    const waiting = plan.pending.find(({ step }) => step.id === stepId)
    if (waiting === undefined) {
      throw plan.aiKeys.has(stepId)
        ? new ConflictError(ALREADY_RUN)
        : new ValidationError(NOT_AN_AI_STEP)
    }
    // A step inside a document layer is that document's: it runs and keeps it.
    if (waiting.documentId !== undefined && waiting.documentId !== documentId) {
      return this.requestAiStep(actor, waiting.documentId, stepId)
    }
    if (plan.pending[0] !== waiting) throw new ValidationError(EARLIER_FIRST)
    const { step } = waiting
    const entry = this.#deps.registry.get(step.tool)
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
      document.pipeline,
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

  /** The export formats this machine can write, in the order the picker shows them. */
  exportFormats(): Promise<Array<ExportFormat>> {
    return writableExportFormats()
  }

  /** A stored preview or thumbnail, for serving. */
  async fetch(
    actor: Actor,
    documentId: string,
    kind: RenderKind,
    key: string,
  ): Promise<OpenedRender> {
    await this.#owned(actor, documentId)
    return this.#openRender(kind, key)
  }

  /** A stored workflow diagram thumbnail or node preview. */
  async fetchWorkflow(
    actor: Actor,
    workflowId: string,
    kind: RenderKind,
    key: string,
  ): Promise<OpenedRender> {
    await this.#ownedWorkflow(actor, workflowId)
    return this.#openRender(kind, key)
  }

  async #openRender(kind: RenderKind, key: string): Promise<OpenedRender> {
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

  async #ownedWorkflow(
    actor: Actor,
    workflowId: string,
  ): Promise<WorkflowRecord> {
    return requireOwned(
      actor,
      await this.#deps.workflows.findById(workflowId),
      MISSING_WORKFLOW,
    )
  }

  async #latestOnlyWorkflow(
    actor: Actor,
    workflow: WorkflowRecord,
    kind: JobKind,
    build: () => Promise<Parameters<JobService['enqueue']>[1]>,
    asked: (payload: JobPayload) => boolean = () => true,
  ): Promise<JobView> {
    const { jobDao, clock, jobs } = this.#deps
    const active = (await jobDao.listActive({ kinds: [kind] })).filter(
      (job) =>
        job.ownerId === actor.userId &&
        job.groupKey === workflow.id &&
        job.payload.kind === kind,
    )
    let current: JobRecord | undefined
    for (const job of active) {
      const revision = 'revision' in job.payload ? job.payload.revision : NO_MAX
      if (revision === workflow.revision && asked(job.payload)) {
        current ??= job
      } else await jobDao.requestCancel(job.id, isoNow(clock))
    }
    if (current !== undefined) return toView(current)
    const [queued] = await jobs.enqueue(actor, await build())
    return this.#only(queued)
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

  #only(job: JobRecord | undefined): JobView {
    if (job === undefined) throw new Error('A job was not queued.')
    return toView(job)
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
    asked: (payload: JobPayload) => boolean = () => true,
  ): Promise<JobView> {
    const { jobDao, clock, jobs } = this.#deps
    const active = await jobDao.listActive({
      documentId: document.id,
      kinds: [kind],
    })
    let current: JobRecord | undefined
    for (const job of active) {
      const revision = 'revision' in job.payload ? job.payload.revision : NO_MAX
      if (revision === document.revision && asked(job.payload)) {
        current ??= job
      } else await jobDao.requestCancel(job.id, isoNow(clock))
    }
    if (current !== undefined) return toView(current)
    const [queued] = await jobs.enqueue(actor, await build())
    return this.#only(queued)
  }
}
