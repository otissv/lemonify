import type { Knex } from 'knex'

import { WorkerPool } from '@/features/ai/ai-tools'

import type { AiToolRegistry } from './ai/ai-tool-registry.ts'
import type { AiEngine } from './ai/ai-engine.ts'
import type { AuthGateway } from './auth/auth-gateway.ts'
import { resolveAuthSecret } from './auth/auth-secret.ts'
import { BetterAuthGateway } from './auth/better-auth-gateway.ts'
import { channelSocketPath, workDir } from './config/config.ts'
import type { Config } from './config/config.ts'
import { connectDatabase, prepareDataDirectories } from './compose/database.ts'
import { buildJobCore } from './compose/job-core.ts'
import { PostgresKeybindingDao } from './dao/postgres/keybinding-dao.ts'
import { PostgresUserDao } from './dao/postgres/user-dao.ts'
import { systemClock, uuidGenerator } from './domain/clock.ts'
import type { Clock, IdGenerator } from './domain/clock.ts'
import { ResendEmailSender } from './email/email-sender.ts'
import type { EmailSender } from './email/email-sender.ts'
import { consoleLogger } from './http/logger.ts'
import { ChannelClient } from './channel/channel-client.ts'
import type { ChangePublisher } from './realtime/change-publisher.ts'
import { RealtimeHub } from './realtime/hub.ts'
import type { HubLimits } from './realtime/hub.ts'
import type { Logger } from './http/logger.ts'
import type { JobRecord } from './jobs/job-types.ts'
import type { Scheduler } from './jobs/scheduler.ts'
import { CreateFromService } from './services/create-from-service.ts'
import { DocumentService } from './services/document-service.ts'
import type { JobService } from './services/job-service.ts'
import { DocumentBundleService } from './services/document-bundle-service.ts'
import { RenderService } from './services/render-service.ts'
import type { ResultService } from './services/result-service.ts'
import { SourceService } from './services/source-service.ts'
import { KeybindingService } from './services/keybinding-service.ts'
import { UserService } from './services/user-service.ts'
import type { WorkflowService } from './services/workflow-service.ts'
import type { ImageEngine } from './tools/image-engine.ts'
import { SharpImageInspector } from './tools/image-inspector.ts'
import { removeOlderThan } from './tools/work-directory.ts'
import { forkWorker } from './worker/fork-worker.ts'
import type { StartWorker } from './worker/fork-worker.ts'
import { WorkerSupervisor } from './worker/supervisor.ts'

const MILLISECONDS_PER_DAY = 86_400_000
/** How long a file with no row is left alone, so an upload that is still being recorded is never swept. */
const ORPHAN_GRACE_MS = 60 * 60 * 1000
/** Work folders of a run or batch that never finished (its process died) are removed after this long. */
const WORK_FOLDER_MAX_AGE_MS = MILLISECONDS_PER_DAY

/**
 * How many tabs the realtime server holds: a person may have this many open,
 * and the server this many in all. A tab that falls this far behind in what it
 * was sent is dropped and reconnects.
 */
const REALTIME_LIMITS: HubLimits = {
  maxConnectionsPerUser: 20,
  maxConnections: 2000,
  maxBufferedBytes: 1024 * 1024,
}

/** Everything the front doors (the API and the CLI) call, built once. */
export type App = {
  config: Config
  database: Knex
  auth: AuthGateway
  /** Whether accounts are confirmed and passwords reset by email. */
  emailEnabled: boolean
  users: UserService
  sources: SourceService
  documents: DocumentService
  results: ResultService
  renders: RenderService
  bundles: DocumentBundleService
  jobs: JobService
  workflows: WorkflowService
  /** Makes a workflow from a document and a document from a workflow. */
  createFrom: CreateFromService
  keybindings: KeybindingService
  aiTools: AiToolRegistry
  /** The open tabs, which the realtime server connects and the services tell about changes. */
  realtime: RealtimeHub
  /**
   * Takes Jobs from the shared queue in this process, for a CLI command or
   * worker. The web server's has no slots: it only fails the Jobs of
   * processes that are gone, and its worker processes run the Jobs.
   */
  /** The web server's worker processes (decision 1, worker processes); undefined in every other process. */
  workers: WorkerSupervisor | undefined
  scheduler: Scheduler
  /**
   * Runs the cleanup once and then daily, and starts what runs Jobs: the
   * worker pool in the web server, this process's scheduler otherwise.
   */
  startBackground(): Promise<void>
  /** Removes files and Jobs nothing refers to any more. */
  runMaintenance(): Promise<void>
  close(): Promise<void>
}

/** Which process the app runs in, which decides how its changes reach open tabs (decision 4, live updates). */
export enum AppRole {
  /** The web server: the services tell its own tabs through the realtime hub. */
  WebServer = 'web-server',
  /** A worker or a CLI command: the services send their changes to the web server's socket. */
  Process = 'process',
}

/** Parts a test can replace; the real ones are built from the configuration. */
export type AppOverrides = {
  /** Which process this is; a CLI command or worker unless the web server says otherwise. */
  role?: AppRole
  auth?: AuthGateway
  imageEngine?: ImageEngine
  aiEngine?: AiEngine
  clock?: Clock
  ids?: IdGenerator
  logger?: Logger
  /** Replaces Resend, for tests; unset, mail goes through Resend when it is configured. */
  email?: EmailSender | null
  /** Where the services say what changed; the realtime hub unless a test listens instead. */
  changes?: ChangePublisher
  /** Starts the web server's worker processes; forked from `src/server/worker/main.ts` unless a test stands in. */
  startWorker?: StartWorker
}

/** The web server runs no Job itself (decision 1, worker processes). */
const NO_SLOTS: Readonly<Record<WorkerPool, number>> = {
  [WorkerPool.Cpu]: 0,
  [WorkerPool.Gpu]: 0,
}

function poolsOf(jobs: ReadonlyArray<JobRecord>): Set<WorkerPool> {
  const pools = new Set<WorkerPool>()
  for (const job of jobs) pools.add(job.pool)
  return pools
}

function buildAuth(
  config: Config,
  email: EmailSender | null,
  logger: Logger,
): AuthGateway {
  return new BetterAuthGateway({
    email,
    logger,
    database: config.database,
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
  const database = await connectDatabase(config.database)

  const clock = overrides.clock ?? systemClock
  const ids = overrides.ids ?? uuidGenerator
  const logger = overrides.logger ?? consoleLogger
  const email =
    overrides.email !== undefined
      ? overrides.email
      : config.email === null
        ? null
        : new ResendEmailSender(config.email)
  const auth = overrides.auth ?? buildAuth(config, email, logger)
  const users = new UserService({ users: new PostgresUserDao(database), auth })
  const realtime = new RealtimeHub(REALTIME_LIMITS, logger)
  const isWebServer = overrides.role === AppRole.WebServer
  // Every other process tells the web server what it changed and queued, through its socket.
  const channel = isWebServer
    ? undefined
    : new ChannelClient(channelSocketPath(config), logger)
  const changes = overrides.changes ?? channel ?? realtime
  let workers: WorkerSupervisor | undefined

  const core = buildJobCore({
    config,
    database,
    clock,
    ids,
    logger,
    changes,
    imageEngine: overrides.imageEngine,
    aiEngine: overrides.aiEngine,
    slots: isWebServer
      ? NO_SLOTS
      : {
          [WorkerPool.Cpu]: config.cpuWorkers,
          [WorkerPool.Gpu]: config.gpuWorkers,
        },
    onQueued: (queued) => {
      const pools = poolsOf(queued)
      workers?.wake(pools)
      channel?.queued(pools)
    },
  })
  const { daos, stores, results, usedItems, jobs, workflows, aiTools } = core
  const inspector = new SharpImageInspector()
  const sources = new SourceService({
    sources: daos.sources,
    store: stores.sources,
    inspector,
    clock,
    ids,
    maxUploadBytes: config.maxUploadBytes,
  })
  const documents = new DocumentService({
    documents: daos.documents,
    sources: daos.sources,
    clock,
    ids,
    cleanup: results,
    changes,
    usedItems,
  })
  const bundles = new DocumentBundleService({
    documents: daos.documents,
    documentService: documents,
    workflowService: workflows,
    usedItems,
    sources,
    results,
    planner: core.planner,
    inspector,
    logger,
    workRoot: workDir(config),
    maxBundleBytes: config.maxBundleBytes,
  })
  const createFrom = new CreateFromService({
    documents,
    workflows,
    sources: daos.sources,
  })
  const keybindings = new KeybindingService({
    keybindings: new PostgresKeybindingDao(database),
    clock,
    changes,
  })
  const renders = new RenderService({
    documents: daos.documents,
    workflows: daos.workflows,
    planner: core.planner,
    jobs,
    jobDao: daos.jobs,
    results,
    renders: stores.renders,
    registry: aiTools,
    clock,
  })
  const running = core.scheduler
  if (isWebServer) {
    workers = new WorkerSupervisor({
      counts: {
        [WorkerPool.Cpu]: config.cpuWorkers,
        [WorkerPool.Gpu]: config.gpuWorkers,
      },
      startWorker: overrides.startWorker ?? forkWorker(config, { logger }),
      queue: daos.jobs,
      reapOrphans: () => running.reapOrphans(),
      logger,
    })
  }

  async function runMaintenance(): Promise<void> {
    await sources.sweepOrphans(ORPHAN_GRACE_MS)
    await results.sweepOrphans(ORPHAN_GRACE_MS)
    await jobs.sweepFinished(config.jobRetentionDays)
    await removeOlderThan(workDir(config), WORK_FOLDER_MAX_AGE_MS)
  }

  let maintenanceTimer: ReturnType<typeof setInterval> | undefined
  let closing: Promise<void> | undefined

  return {
    config,
    database,
    auth,
    emailEnabled: email !== null,
    users,
    sources,
    documents,
    results,
    renders,
    bundles,
    jobs,
    workflows,
    createFrom,
    keybindings,
    aiTools,
    realtime,
    workers,
    scheduler: running,
    runMaintenance,
    async startBackground() {
      await runMaintenance()
      if (workers === undefined) await running.start()
      else await workers.start()
      maintenanceTimer = setInterval(() => {
        runMaintenance().catch((error: unknown) => {
          logger.error('Cleanup failed', {
            detail: error instanceof Error ? error.message : String(error),
          })
        })
      }, MILLISECONDS_PER_DAY)
      maintenanceTimer.unref()
    },
    close() {
      closing ??= (async () => {
        if (maintenanceTimer !== undefined) clearInterval(maintenanceTimer)
        await workers?.stop()
        await running.stop({ abort: true })
        await channel?.close()
        await auth.close()
        await database.destroy()
      })()
      return closing
    },
  }
}
