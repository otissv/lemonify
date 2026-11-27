import type { Knex } from 'knex'

import type { WorkerPool } from '@/features/ai/ai-tools'

import { AiToolRegistry, upscaleEntry } from '../ai/ai-tool-registry.ts'
import type { AiEngine } from '../ai/ai-engine.ts'
import { UpscaylCliEngine } from '../ai/upscayl-cli-engine.ts'
import {
  renderCacheDir,
  resultsDir,
  sourcesDir,
  workDir,
} from '../config/config.ts'
import type { Config } from '../config/config.ts'
import { PostgresDocumentDao } from '../dao/postgres/document-dao.ts'
import { PostgresJobDao } from '../dao/postgres/job-dao.ts'
import { PostgresResultDao } from '../dao/postgres/result-dao.ts'
import { PostgresSourceDao } from '../dao/postgres/source-dao.ts'
import { PostgresWorkflowDao } from '../dao/postgres/workflow-dao.ts'
import type { Clock, IdGenerator } from '../domain/clock.ts'
import type { Logger } from '../http/logger.ts'
import { AiStepHandler } from '../jobs/handlers/ai-step-handler.ts'
import { ExportHandler } from '../jobs/handlers/export-handler.ts'
import { PreviewHandler } from '../jobs/handlers/preview-handler.ts'
import { RunItemHandler } from '../jobs/handlers/run-item-handler.ts'
import { ThumbnailHandler } from '../jobs/handlers/thumbnail-handler.ts'
import { WorkflowPreviewHandler } from '../jobs/handlers/workflow-preview-handler.ts'
import { WorkflowThumbnailHandler } from '../jobs/handlers/workflow-thumbnail-handler.ts'
import { JobKind } from '../jobs/job-types.ts'
import type { JobRecord } from '../jobs/job-types.ts'
import { Scheduler } from '../jobs/scheduler.ts'
import type { ChangePublisher } from '../realtime/change-publisher.ts'
import { DocumentPlanner } from '../render/document-planner.ts'
import { WorkflowPlanner } from '../render/workflow-planner.ts'
import { JobService } from '../services/job-service.ts'
import { ResultService } from '../services/result-service.ts'
import { UsedItems } from '../services/used-items.ts'
import { WorkflowService } from '../services/workflow-service.ts'
import { SharpImageEngine } from '../tools/image-engine.ts'
import type { ImageEngine } from '../tools/image-engine.ts'
import { FileRenderStore } from '../tools/render-store.ts'
import { FileResultStore } from '../tools/result-store.ts'
import { FileSourceStore } from '../tools/source-store.ts'

export type JobCoreDeps = {
  config: Config
  database: Knex
  clock: Clock
  ids: IdGenerator
  logger: Logger
  changes: ChangePublisher
  /** Sharp unless a test stands in for it. */
  imageEngine?: ImageEngine
  /** Upscayl unless a test stands in for it. */
  aiEngine?: AiEngine
  /** How many Jobs of each pool this process runs at once; a pool with none is never run here. */
  slots: Readonly<Record<WorkerPool, number>>
  /** Told after Jobs are queued here, for processes that run them elsewhere (the web server's workers). */
  onQueued?: (jobs: ReadonlyArray<JobRecord>) => void
}

/** What runs Jobs, and what queuing and finishing them needs: shared by the web server, the CLI and the workers. */
export type JobCore = {
  daos: {
    sources: PostgresSourceDao
    documents: PostgresDocumentDao
    results: PostgresResultDao
    jobs: PostgresJobDao
    workflows: PostgresWorkflowDao
  }
  stores: {
    sources: FileSourceStore
    results: FileResultStore
    renders: FileRenderStore
  }
  results: ResultService
  usedItems: UsedItems
  aiTools: AiToolRegistry
  planner: DocumentPlanner
  workflowPlanner: WorkflowPlanner
  jobs: JobService
  workflows: WorkflowService
  /** Takes Jobs from the shared queue. Not running until it is started. */
  scheduler: Scheduler
}

/** How many Jobs may run together with `job`: the configured size, lowered by the AI tool if it asks. */
function batchLimitOf(
  job: JobRecord,
  registry: AiToolRegistry,
  configured: number,
): number {
  const { payload } = job
  if (
    (payload.kind === JobKind.AiStep || payload.kind === JobKind.RunItem) &&
    payload.tool !== undefined
  ) {
    return Math.min(
      configured,
      registry.get(payload.tool).maxBatch ?? configured,
    )
  }
  return configured
}

function buildDaos(database: Knex): JobCore['daos'] {
  return {
    sources: new PostgresSourceDao(database),
    documents: new PostgresDocumentDao(database),
    results: new PostgresResultDao(database),
    jobs: new PostgresJobDao(database),
    workflows: new PostgresWorkflowDao(database),
  }
}

function buildStores(config: Config): JobCore['stores'] {
  return {
    sources: new FileSourceStore(sourcesDir(config)),
    results: new FileResultStore(resultsDir(config)),
    renders: new FileRenderStore(
      renderCacheDir(config),
      config.renderCacheBytes,
    ),
  }
}

type Parts = Omit<JobCore, 'scheduler'> & { imageEngine: ImageEngine }

function buildHandlers(
  deps: JobCoreDeps,
  parts: Parts,
): ConstructorParameters<typeof Scheduler>[0]['handlers'] {
  const { config, logger, changes } = deps
  const { daos, stores, imageEngine: engine, planner, results } = parts
  const rendering = { planner, renders: stores.renders, engine, logger }
  const diagrams = {
    ...rendering,
    workflows: daos.workflows,
    workflowPlanner: parts.workflowPlanner,
  }
  const workRoot = workDir(config)
  return {
    [JobKind.Preview]: new PreviewHandler(rendering),
    [JobKind.Thumbnail]: new ThumbnailHandler(rendering),
    [JobKind.WorkflowThumbnail]: new WorkflowThumbnailHandler(diagrams),
    [JobKind.WorkflowPreview]: new WorkflowPreviewHandler(diagrams),
    [JobKind.Export]: new ExportHandler({
      planner,
      engine,
      results,
      workRoot,
      logger,
    }),
    [JobKind.AiStep]: new AiStepHandler({
      planner,
      engine,
      registry: parts.aiTools,
      results,
      workRoot,
      logger,
      usedItems: parts.usedItems,
      changes,
    }),
    [JobKind.RunItem]: new RunItemHandler({
      workflows: daos.workflows,
      sources: daos.sources,
      sourceStore: stores.sources,
      engine,
      registry: parts.aiTools,
      results,
      jobs: parts.jobs,
      workRoot,
      logger,
    }),
  }
}

/** The services that queue and finish Jobs, and the scheduler that runs them in this process. */
export function buildJobCore(deps: JobCoreDeps): JobCore {
  const { config, clock, ids, logger, changes } = deps
  const daos = buildDaos(deps.database)
  const stores = buildStores(config)
  const results = new ResultService({
    results: daos.results,
    store: stores.results,
    clock,
    ids,
    maxBytesPerUser: config.maxResultBytesPerUser,
    changes,
  })
  const usedItems = new UsedItems({
    documents: daos.documents,
    workflows: daos.workflows,
  })
  const aiTools = new AiToolRegistry([
    upscaleEntry(
      deps.aiEngine ?? new UpscaylCliEngine({ workRoot: workDir(config) }),
    ),
  ])
  const planner = new DocumentPlanner({
    documents: daos.documents,
    workflows: daos.workflows,
    sources: daos.sources,
    sourceStore: stores.sources,
    results,
  })
  const workflowPlanner = new WorkflowPlanner({
    documents: daos.documents,
    workflows: daos.workflows,
    sources: daos.sources,
    sourceStore: stores.sources,
  })
  let scheduler: Scheduler | undefined
  const jobs = new JobService({
    jobs: daos.jobs,
    clock,
    ids,
    maxWaitingPerUser: config.maxWaitingJobsPerUser,
    onQueued: (queued) => {
      scheduler?.wake()
      deps.onQueued?.(queued)
    },
  })
  const workflows = new WorkflowService({
    workflows: daos.workflows,
    sources: daos.sources,
    jobs,
    jobDao: daos.jobs,
    registry: aiTools,
    clock,
    ids,
    workRoot: workDir(config),
    results,
    changes,
    usedItems,
  })
  const parts: Parts = {
    daos,
    stores,
    results,
    usedItems,
    aiTools,
    planner,
    workflowPlanner,
    jobs,
    workflows,
    imageEngine: deps.imageEngine ?? new SharpImageEngine(),
  }
  scheduler = new Scheduler({
    jobs: daos.jobs,
    clock,
    logger,
    slots: deps.slots,
    groupSharePercent: config.groupSharePercent,
    batchLimit: (job) => batchLimitOf(job, aiTools, config.aiBatchSize),
    onFinished: (job) => workflows.onJobFinished(job),
    handlers: buildHandlers(deps, parts),
  })
  const { imageEngine: _engine, ...core } = parts
  return { ...core, scheduler }
}
