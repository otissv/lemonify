import os from 'node:os'
import path from 'node:path'

import { z } from 'zod'

import { ValidationError } from '../errors.ts'

const MAX_DEFAULT_CPU_WORKERS = 4
const MEGABYTE = 1024 * 1024
const GIGABYTE = 1024 * MEGABYTE

const positiveInteger = (max: number) => z.coerce.number().int().min(1).max(max)

/** The variables the app reads; every one is optional. */
const EnvironmentSchema = z.object({
  LEMONIFY_DATA_DIR: z.string().min(1).default('.data'),
  LEMONIFY_DATABASE: z.literal('sqlite').default('sqlite'),
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
  LEMONIFY_AUTH_SECRET: z.string().min(32).optional(),
  LEMONIFY_BASE_URL: z.url().default('http://localhost:3100'),
  LEMONIFY_TRUSTED_ORIGINS: z.string().default(''),
})

export type Config = {
  dataDir: string
  database: 'sqlite'
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
  authSecret: string | undefined
  baseUrl: string
  trustedOrigins: string[]
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
  return {
    dataDir: path.resolve(cwd, env.LEMONIFY_DATA_DIR),
    database: env.LEMONIFY_DATABASE,
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
    authSecret: env.LEMONIFY_AUTH_SECRET,
    baseUrl: env.LEMONIFY_BASE_URL,
    trustedOrigins: parseOrigins(
      env.LEMONIFY_BASE_URL,
      env.LEMONIFY_TRUSTED_ORIGINS,
    ),
  }
}

export function databaseFile(config: Pick<Config, 'dataDir'>): string {
  return path.join(config.dataDir, 'lemonify.sqlite')
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
