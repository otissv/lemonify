import { mkdirSync } from 'node:fs'

import type { Knex } from 'knex'

import { WorkerPool } from '@/features/ai/ai-tools'

import { AiToolRegistry, upscaleEntry } from './ai/ai-tool-registry.ts'
import type { AiEngine } from './ai/ai-engine.ts'
import { UpscaylCliEngine } from './ai/upscayl-cli-engine.ts'
import type { AuthGateway } from './auth/auth-gateway.ts'
import { resolveAuthSecret } from './auth/auth-secret.ts'
import { BetterAuthGateway } from './auth/better-auth-gateway.ts'
import {
  databaseFile,
  renderCacheDir,
  resultsDir,
  sourcesDir,
  workDir,
} from './config/config.ts'
import type { Config } from './config/config.ts'
import { SqliteDocumentDao } from './dao/sqlite/document-dao.ts'
import { SqliteJobDao } from './dao/sqlite/job-dao.ts'
import { SqliteResultDao } from './dao/sqlite/result-dao.ts'
import { SqliteSourceDao } from './dao/sqlite/source-dao.ts'
import { SqliteUserDao } from './dao/sqlite/user-dao.ts'
import { SqliteWorkflowDao } from './dao/sqlite/workflow-dao.ts'
import { openDatabase } from './database/connection.ts'
import { migrateToLatest } from './database/migrate.ts'
import { systemClock, uuidGenerator } from './domain/clock.ts'
import type { Clock, IdGenerator } from './domain/clock.ts'
import { consoleLogger } from './http/logger.ts'
import type { Logger } from './http/logger.ts'
import { AiStepHandler } from './jobs/handlers/ai-step-handler.ts'
import { ExportHandler } from './jobs/handlers/export-handler.ts'
import { RunItemHandler } from './jobs/handlers/run-item-handler.ts'
import { PreviewHandler } from './jobs/handlers/preview-handler.ts'
import { ThumbnailHandler } from './jobs/handlers/thumbnail-handler.ts'
import { JobKind } from './jobs/job-types.ts'
import type { JobRecord } from './jobs/job-types.ts'
import { Scheduler } from './jobs/scheduler.ts'
import { DocumentPlanner } from './render/document-planner.ts'
import { DocumentService } from './services/document-service.ts'
import { JobService } from './services/job-service.ts'
import { RenderService } from './services/render-service.ts'
import { ResultService } from './services/result-service.ts'
import { SourceService } from './services/source-service.ts'
import { UserService } from './services/user-service.ts'
import { WorkflowService } from './services/workflow-service.ts'
import { SharpImageEngine } from './tools/image-engine.ts'
import type { ImageEngine } from './tools/image-engine.ts'
import { SharpImageInspector } from './tools/image-inspector.ts'
import { FileRenderStore } from './tools/render-store.ts'
import { FileResultStore } from './tools/result-store.ts'
import { FileSourceStore } from './tools/source-store.ts'
import { removeOlderThan } from './tools/work-directory.ts'

const MILLISECONDS_PER_DAY = 86_400_000
/** How long a file with no row is left alone, so an upload that is still being recorded is never swept. */
const ORPHAN_GRACE_MS = 60 * 60 * 1000
/** Work folders of a run or batch that never finished (its process died) are removed after this long. */
const WORK_FOLDER_MAX_AGE_MS = MILLISECONDS_PER_DAY

/** Everything the front doors (the API and the CLI) call, built once. */
export type App = {
  config: Config
  database: Knex
  auth: AuthGateway
  users: UserService
  sources: SourceService
  documents: DocumentService
  results: ResultService
  renders: RenderService
  jobs: JobService
  workflows: WorkflowService
  aiTools: AiToolRegistry
  /** Takes Jobs from the shared queue. Not running until `startBackground` is called. */
  scheduler: Scheduler
  /** Starts the scheduler and the daily cleanup, after running the cleanup once. */
  startBackground(): Promise<void>
  /** Removes files and Jobs nothing refers to any more. */
  runMaintenance(): Promise<void>
  close(): Promise<void>
}

/** Parts a test can replace; the real ones are built from the configuration. */
export type AppOverrides = {
  auth?: AuthGateway
  imageEngine?: ImageEngine
  aiEngine?: AiEngine
  clock?: Clock
  ids?: IdGenerator
  logger?: Logger
}

function prepareDataDirectories(config: Config): void {
  for (const dir of [
    config.dataDir,
    sourcesDir(config),
    resultsDir(config),
    renderCacheDir(config),
    workDir(config),
  ]) {
    mkdirSync(dir, { recursive: true })
  }
}

function buildAuth(config: Config, file: string): AuthGateway {
  return new BetterAuthGateway({
    databaseFile: file,
    secret: resolveAuthSecret(config.authSecret, config.dataDir),
    baseUrl: config.baseUrl,
    trustedOrigins: config.trustedOrigins,
  })
}

/**
 * The one place that decides which implementation backs each interface. The
 * server and the CLI both call it, so they run the same services. Nothing
 * else reads the configuration.
 */
export async function createApp(
  config: Config,
  overrides: AppOverrides = {},
): Promise<App> {
  prepareDataDirectories(config)
  const file = databaseFile(config)
  const database = openDatabase(file)
  await migrateToLatest(database)

  const clock = overrides.clock ?? systemClock
  const ids = overrides.ids ?? uuidGenerator
  const logger = overrides.logger ?? consoleLogger
  const auth = overrides.auth ?? buildAuth(config, file)
  const users = new UserService({ users: new SqliteUserDao(database), auth })

  const sourceDao = new SqliteSourceDao(database)
  const documentDao = new SqliteDocumentDao(database)
  const resultDao = new SqliteResultDao(database)
  const jobDao = new SqliteJobDao(database)
  const workflowDao = new SqliteWorkflowDao(database)
  const sourceStore = new FileSourceStore(sourcesDir(config))
  const resultStore = new FileResultStore(resultsDir(config))
  const renderStore = new FileRenderStore(
    renderCacheDir(config),
    config.renderCacheBytes,
  )

  const results = new ResultService({
    results: resultDao,
    store: resultStore,
    clock,
    ids,
    maxBytesPerUser: config.maxResultBytesPerUser,
  })
  const sources = new SourceService({
    sources: sourceDao,
    store: sourceStore,
    inspector: new SharpImageInspector(),
    clock,
    ids,
    maxUploadBytes: config.maxUploadBytes,
  })
  const documents = new DocumentService({
    documents: documentDao,
    sources: sourceDao,
    clock,
    ids,
    cleanup: results,
  })

  const imageEngine = overrides.imageEngine ?? new SharpImageEngine()
  const aiTools = new AiToolRegistry([
    upscaleEntry(
      overrides.aiEngine ?? new UpscaylCliEngine({ workRoot: workDir(config) }),
    ),
  ])
  const planner = new DocumentPlanner({
    documents: documentDao,
    sources: sourceDao,
    sourceStore,
    results,
  })

  let scheduler: Scheduler | undefined
  const jobs = new JobService({
    jobs: jobDao,
    clock,
    ids,
    maxWaitingPerUser: config.maxWaitingJobsPerUser,
    onQueued: () => scheduler?.wake(),
  })
  const workflows = new WorkflowService({
    workflows: workflowDao,
    sources: sourceDao,
    jobs,
    jobDao,
    registry: aiTools,
    clock,
    ids,
    workRoot: workDir(config),
    results,
  })
  const renders = new RenderService({
    documents: documentDao,
    planner,
    jobs,
    jobDao,
    results,
    renders: renderStore,
    registry: aiTools,
    clock,
  })

  const running = new Scheduler({
    jobs: jobDao,
    clock,
    logger,
    slots: {
      [WorkerPool.Cpu]: config.cpuWorkers,
      [WorkerPool.Gpu]: config.gpuWorkers,
    },
    groupSharePercent: config.groupSharePercent,
    batchLimit: (job) => batchLimitOf(job, aiTools, config.aiBatchSize),
    onFinished: (job) => workflows.onJobFinished(job),
    handlers: {
      [JobKind.Preview]: new PreviewHandler({
        planner,
        renders: renderStore,
        engine: imageEngine,
        logger,
      }),
      [JobKind.Thumbnail]: new ThumbnailHandler({
        planner,
        renders: renderStore,
        engine: imageEngine,
        logger,
      }),
      [JobKind.Export]: new ExportHandler({
        planner,
        engine: imageEngine,
        results,
        workRoot: workDir(config),
        logger,
      }),
      [JobKind.AiStep]: new AiStepHandler({
        planner,
        engine: imageEngine,
        registry: aiTools,
        results,
        workRoot: workDir(config),
        logger,
      }),
      [JobKind.RunItem]: new RunItemHandler({
        workflows: workflowDao,
        sources: sourceDao,
        sourceStore,
        engine: imageEngine,
        registry: aiTools,
        results,
        jobs,
        workRoot: workDir(config),
        logger,
      }),
    },
  })
  scheduler = running

  async function runMaintenance(): Promise<void> {
    await sources.sweepOrphans(ORPHAN_GRACE_MS)
    await results.sweepOrphans(ORPHAN_GRACE_MS)
    await jobs.sweepFinished(config.jobRetentionDays)
    await removeOlderThan(workDir(config), WORK_FOLDER_MAX_AGE_MS)
  }

  let maintenanceTimer: ReturnType<typeof setInterval> | undefined

  return {
    config,
    database,
    auth,
    users,
    sources,
    documents,
    results,
    renders,
    jobs,
    workflows,
    aiTools,
    scheduler: running,
    runMaintenance,
    async startBackground() {
      await runMaintenance()
      await running.start()
      maintenanceTimer = setInterval(() => {
        runMaintenance().catch((error: unknown) => {
          logger.error('Cleanup failed', {
            detail: error instanceof Error ? error.message : String(error),
          })
        })
      }, MILLISECONDS_PER_DAY)
      maintenanceTimer.unref()
    },
    async close() {
      if (maintenanceTimer !== undefined) clearInterval(maintenanceTimer)
      await running.stop({ abort: true })
      auth.close()
      await database.destroy()
    },
  }
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
