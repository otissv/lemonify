import os from 'node:os'
import path from 'node:path'

import { z } from 'zod'

import { REALTIME_PATH } from '@/features/realtime/realtime-events'
import { ValidationError } from '../errors.ts'
import { DEFAULT_SITE_PORT } from './site-port.ts'

const MAX_DEFAULT_CPU_WORKERS = 4
/** The longest socket path every system Lemonify runs on takes (macOS allows 104 bytes with the terminating null). */
const MAX_SOCKET_PATH_BYTES = 103
const MEGABYTE = 1024 * 1024
const GIGABYTE = 1024 * MEGABYTE

const positiveInteger = (max: number) => z.coerce.number().int().min(1).max(max)

/** A setting that is left blank in an env file counts as not set. */
const blankIsUnset = (schema: z.ZodString) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() || undefined : value),
    schema.optional(),
  )

/** The variables the app reads; all but the POSTGRES_ settings are optional. */
const EnvironmentSchema = z.object({
  /** The port the website listens on; the addresses below follow it unless they are set. */
  PORT: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() || undefined : value),
    positiveInteger(65_535).default(DEFAULT_SITE_PORT),
  ),
  LEMONIFY_DATA_DIR: z.string().min(1).default('.data'),
  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PORT: positiveInteger(65_535),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_DATABASE: z.string().min(1),
  POSTGRES_SCHEMA: z
    .string()
    .regex(
      /^[a-z_][a-z0-9_]*$/,
      'it must be a lower-case name of letters, digits and underscores',
    ),
  LEMONIFY_DATABASE_POOL_SIZE: positiveInteger(1000).default(10),
  LEMONIFY_CPU_WORKERS: positiveInteger(64).optional(),
  LEMONIFY_GPU_WORKERS: positiveInteger(16).default(1),
  LEMONIFY_GROUP_SHARE: positiveInteger(100).default(50),
  LEMONIFY_MAX_WAITING_JOBS_PER_USER: positiveInteger(100_000).default(200),
  LEMONIFY_MAX_UPLOAD_BYTES: positiveInteger(Number.MAX_SAFE_INTEGER).default(
    100 * MEGABYTE,
  ),
  LEMONIFY_MAX_BUNDLE_BYTES: positiveInteger(Number.MAX_SAFE_INTEGER).default(
    GIGABYTE,
  ),
  LEMONIFY_AI_BATCH_SIZE: positiveInteger(1000).default(8),
  LEMONIFY_JOB_RETENTION_DAYS: positiveInteger(3650).default(30),
  LEMONIFY_MAX_RESULT_BYTES_PER_USER: positiveInteger(
    Number.MAX_SAFE_INTEGER,
  ).default(20 * GIGABYTE),
  LEMONIFY_RENDER_CACHE_BYTES: positiveInteger(Number.MAX_SAFE_INTEGER).default(
    2 * GIGABYTE,
  ),
  LEMONIFY_RATE_LIMIT_MULTIPLIER: positiveInteger(1000).default(1),
  LEMONIFY_AUTH_SECRET: z.string().min(32).optional(),
  LEMONIFY_BASE_URL: z.url().optional(),
  LEMONIFY_TRUSTED_ORIGINS: z.string().default(''),
  LEMONIFY_REALTIME_PORT: positiveInteger(65_535).optional(),
  LEMONIFY_REALTIME_HOST: z.string().min(1).default('127.0.0.1'),
  LEMONIFY_REALTIME_URL: z.url().optional(),
  LEMONIFY_RESEND_API_KEY: blankIsUnset(z.string().min(1)),
  LEMONIFY_EMAIL_FROM: blankIsUnset(z.string().min(3)),
})

export type EmailConfig = {
  apiKey: string
  /** The sender shown to the recipient; its domain must be verified in Resend. */
  from: string
}

export type DatabaseConfig = {
  host: string
  port: number
  user: string
  password: string
  database: string
  /** The schema the tables live in. */
  schema: string
  /** The most connections each process keeps open. */
  poolSize: number
}

export type Config = {
  dataDir: string
  database: DatabaseConfig
  cpuWorkers: number
  gpuWorkers: number
  groupSharePercent: number
  maxWaitingJobsPerUser: number
  maxUploadBytes: number
  maxBundleBytes: number
  aiBatchSize: number
  jobRetentionDays: number
  maxResultBytesPerUser: number
  renderCacheBytes: number
  /** How many times looser than its usual limit each kind of request is allowed to be. */
  rateLimitMultiplier: number
  authSecret: string | undefined
  baseUrl: string
  trustedOrigins: string[]
  /** The server that tells open tabs when something changed. */
  realtime: RealtimeConfig
  /** Where email is sent from; null when no Resend key is set, and then no email is sent or required. */
  email: EmailConfig | null
}

export type RealtimeConfig = {
  /** The address it listens on. The default keeps it to this machine, for a proxy to forward to. */
  host: string
  port: number
  /** The websocket address a browser connects to. */
  url: string
}

export function defaultCpuWorkers(cpuCount: number): number {
  return Math.min(Math.max(cpuCount, 1), MAX_DEFAULT_CPU_WORKERS)
}

function parseOrigins(baseUrl: string, list: string): string[] {
  const origins = new Set<string>([new URL(baseUrl).origin])
  for (const entry of list.split(',')) {
    const trimmed = entry.trim()
    if (trimmed === '') continue
    origins.add(new URL(trimmed).origin)
  }
  return [...origins]
}

function emailConfig(
  env: z.output<typeof EnvironmentSchema>,
): EmailConfig | null {
  const apiKey = env.LEMONIFY_RESEND_API_KEY
  const from = env.LEMONIFY_EMAIL_FROM
  if (apiKey === undefined && from === undefined) return null
  if (apiKey === undefined || from === undefined) {
    throw new ValidationError(
      'The configuration is not valid. LEMONIFY_RESEND_API_KEY and LEMONIFY_EMAIL_FROM go together: set both to send email, or neither.',
    )
  }
  return { apiKey, from }
}

/** The site's address: the one set, or this machine on the port the website listens on. */
function siteUrl(env: z.output<typeof EnvironmentSchema>): string {
  return env.LEMONIFY_BASE_URL ?? `http://localhost:${env.PORT}`
}

function realtimeConfig(
  env: z.output<typeof EnvironmentSchema>,
): RealtimeConfig {
  const site = new URL(siteUrl(env))
  const secure = site.protocol === 'https:'
  const realtimePort = env.LEMONIFY_REALTIME_PORT ?? env.PORT + 1
  const ownPorts = [String(env.PORT), site.port]
  if (ownPorts.includes(String(realtimePort))) {
    throw new ValidationError(
      'The configuration is not valid. LEMONIFY_REALTIME_PORT: it is the port the website listens on, so it needs a port of its own.',
    )
  }
  const url = env.LEMONIFY_REALTIME_URL
  if (url !== undefined) {
    const { protocol } = new URL(url)
    if (protocol !== 'ws:' && protocol !== 'wss:') {
      throw new ValidationError(
        'The configuration is not valid. LEMONIFY_REALTIME_URL: it must start with ws:// or wss://.',
      )
    }
    if (secure && protocol !== 'wss:') {
      throw new ValidationError(
        'The configuration is not valid. LEMONIFY_REALTIME_URL: a site served over https needs a wss:// address.',
      )
    }
  }
  return {
    host: env.LEMONIFY_REALTIME_HOST,
    port: realtimePort,
    url:
      url ??
      `${secure ? 'wss' : 'ws'}://${site.hostname}:${realtimePort}${REALTIME_PATH}`,
  }
}

/**
 * Reads the configuration once, from `environment`. The values are checked by
 * one schema, so a bad value stops the app at startup with a message that
 * names the variable.
 */
export function loadConfig(
  environment: NodeJS.ProcessEnv,
  cpuCount: number = os.availableParallelism(),
  cwd: string = process.cwd(),
): Config {
  const parsed = EnvironmentSchema.safeParse(environment)
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    )
    throw new ValidationError(
      `The configuration is not valid. ${problems.join('; ')}`,
    )
  }
  const env = parsed.data
  const dataDir = path.resolve(cwd, env.LEMONIFY_DATA_DIR)
  checkSocketPath(dataDir)
  return {
    dataDir,
    database: {
      host: env.POSTGRES_HOST,
      port: env.POSTGRES_PORT,
      user: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD,
      database: env.POSTGRES_DATABASE,
      schema: env.POSTGRES_SCHEMA,
      poolSize: env.LEMONIFY_DATABASE_POOL_SIZE,
    },
    cpuWorkers: env.LEMONIFY_CPU_WORKERS ?? defaultCpuWorkers(cpuCount),
    gpuWorkers: env.LEMONIFY_GPU_WORKERS,
    groupSharePercent: env.LEMONIFY_GROUP_SHARE,
    maxWaitingJobsPerUser: env.LEMONIFY_MAX_WAITING_JOBS_PER_USER,
    maxUploadBytes: env.LEMONIFY_MAX_UPLOAD_BYTES,
    maxBundleBytes: env.LEMONIFY_MAX_BUNDLE_BYTES,
    aiBatchSize: env.LEMONIFY_AI_BATCH_SIZE,
    jobRetentionDays: env.LEMONIFY_JOB_RETENTION_DAYS,
    maxResultBytesPerUser: env.LEMONIFY_MAX_RESULT_BYTES_PER_USER,
    renderCacheBytes: env.LEMONIFY_RENDER_CACHE_BYTES,
    rateLimitMultiplier: env.LEMONIFY_RATE_LIMIT_MULTIPLIER,
    authSecret: env.LEMONIFY_AUTH_SECRET,
    baseUrl: siteUrl(env),
    trustedOrigins: parseOrigins(siteUrl(env), env.LEMONIFY_TRUSTED_ORIGINS),
    realtime: realtimeConfig(env),
    email: emailConfig(env),
  }
}

/** Where the web server listens for changes from the other processes, in a folder only its user can enter. */
export function channelSocketPath(config: Pick<Config, 'dataDir'>): string {
  return path.join(config.dataDir, 'run', 'lemonify.sock')
}

function checkSocketPath(dataDir: string): void {
  const socketPath = channelSocketPath({ dataDir })
  if (Buffer.byteLength(socketPath) <= MAX_SOCKET_PATH_BYTES) return
  throw new ValidationError(
    `The configuration is not valid. LEMONIFY_DATA_DIR: the path is too long for the web server's socket (${socketPath}); choose a folder at most ${MAX_SOCKET_PATH_BYTES - (socketPath.length - dataDir.length)} characters long.`,
  )
}

export function sourcesDir(config: Pick<Config, 'dataDir'>): string {
  return path.join(config.dataDir, 'sources')
}

export function resultsDir(config: Pick<Config, 'dataDir'>): string {
  return path.join(config.dataDir, 'results')
}

/** Scratch space for Jobs; on the same disk as the stores so finished files move without a copy. */
export function workDir(config: Pick<Config, 'dataDir'>): string {
  return path.join(config.dataDir, 'work')
}

export function renderCacheDir(config: Pick<Config, 'dataDir'>): string {
  return path.join(config.dataDir, 'render-cache')
}
