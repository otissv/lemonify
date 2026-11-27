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
import { SocketChangePublisher } from './channel/socket-change-publisher.ts'
import type { ChangePublisher } from './realtime/change-publisher.ts'
import { RealtimeHub } from './realtime/hub.ts'
import type { HubLimits } from './realtime/hub.ts'
import type { Logger } from './http/logger.ts'
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
  /** Takes Jobs from the shared queue. Not running until `startBackground` is called. */
  scheduler: Scheduler
  /** Starts the scheduler and the daily cleanup, after running the cleanup once. */
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
  const sentChanges =
    overrides.changes === undefined &&
    (overrides.role ?? AppRole.Process) === AppRole.Process
      ? new SocketChangePublisher(channelSocketPath(config), logger)
      : undefined
  const changes = overrides.changes ?? sentChanges ?? realtime

  const core = buildJobCore({
    config,
    database,
    clock,
    ids,
    logger,
    changes,
    imageEngine: overrides.imageEngine,
    aiEngine: overrides.aiEngine,
    slots: {
      [WorkerPool.Cpu]: config.cpuWorkers,
      [WorkerPool.Gpu]: config.gpuWorkers,
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
      await sentChanges?.close()
      await auth.close()
      await database.destroy()
    },
  }
}
