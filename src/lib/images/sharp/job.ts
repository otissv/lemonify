import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { OutputInfo, Sharp } from 'sharp'
import { z } from 'zod'

import { parseWithSchema } from '../options.ts'
import { mirroredPath } from '../plan.ts'
import { collectSources } from '../sources.ts'
import { readableExtensions } from './capabilities.ts'
import { filePathSchema, nonNegativeIntSchema } from './common.ts'
import { SharpOperationError, SharpTargetError } from './errors.ts'
import { sharpInputOptionsSchema } from './input-options.ts'
import { applySharpOps, formatExtension, sharpOpSchema } from './ops.ts'

/** Process-wide Sharp settings (`sharp.concurrency()`, `sharp.cache()`, …) applied before the job runs. */
export const sharpSettingsSchema = z.strictObject({
  concurrency: nonNegativeIntSchema.optional(),
  cache: z
    .union([
      z.boolean(),
      z.strictObject({
        memory: nonNegativeIntSchema.optional(),
        files: nonNegativeIntSchema.optional(),
        items: nonNegativeIntSchema.optional(),
      }),
    ])
    .optional(),
  simd: z.boolean().optional(),
  block: z.array(z.string().min(1)).min(1).optional(),
  unblock: z.array(z.string().min(1)).min(1).optional(),
})
type SharpSettings = z.infer<typeof sharpSettingsSchema>

/**
 * A Sharp pipeline: read `input` (a file, a folder, several files to
 * `join`, or nothing when `options.create`/`options.text` generates the
 * image), apply `ops` in order, and write to `output`.
 */
export const sharpJobSchema = z
  .strictObject({
    input: z.union([filePathSchema, z.array(filePathSchema).min(2)]).optional(),
    output: filePathSchema,
    options: sharpInputOptionsSchema.optional(),
    ops: z.array(sharpOpSchema).default([]),
    settings: sharpSettingsSchema.optional(),
    recursive: z
      .boolean()
      .default(false)
      .describe('When input is a folder, include subfolders'),
  })
  .superRefine((job, context) => {
    const generated = job.options?.create ?? job.options?.text
    const several = Array.isArray(job.input)
    const problems: string[] = []
    if (job.input === undefined && !generated)
      problems.push('Provide input, or options.create / options.text')
    if (job.input !== undefined && generated)
      problems.push(
        'input cannot be combined with options.create or options.text',
      )
    if (several && !job.options?.join)
      problems.push('Several inputs need options.join')
    if (!several && job.options?.join)
      problems.push('options.join needs several inputs')
    for (const message of problems)
      context.addIssue({ code: 'custom', message })
  })
export type SharpJobInput = z.input<typeof sharpJobSchema>
export type SharpJob = z.output<typeof sharpJobSchema>

export interface SharpJobResult {
  /** The input file, the joined files, or null for a generated image. */
  source: string | string[] | null
  output: string
  info: OutputInfo
}

interface SharpTask {
  source: string | string[] | null
  output: string
}

function applySettings(settings: SharpSettings | undefined): void {
  if (!settings) return
  if (settings.concurrency !== undefined)
    sharp.concurrency(settings.concurrency)
  if (settings.cache !== undefined) sharp.cache(settings.cache)
  if (settings.simd !== undefined) sharp.simd(settings.simd)
  if (settings.block) sharp.block({ operation: settings.block })
  if (settings.unblock) sharp.unblock({ operation: settings.unblock })
}

async function isDirectory(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isDirectory()
  } catch {
    return false
  }
}

async function planFolder(job: SharpJob, folder: string): Promise<SharpTask[]> {
  const output = path.resolve(job.output)
  const sources = await collectSources(folder, {
    recursive: job.recursive,
    exclude: output,
    extensions: readableExtensions(),
  })
  const extension = formatExtension(job.ops)
  const tasks: SharpTask[] = []
  for (const source of sources.files) {
    const mirrored = mirroredPath(source, sources.root, output)
    const target = extension
      ? path.join(
          path.dirname(mirrored),
          `${path.parse(mirrored).name}${extension}`,
        )
      : mirrored
    if (target === source) throw new SharpTargetError(source)
    tasks.push({ source, output: target })
  }
  return tasks
}

async function planTasks(job: SharpJob): Promise<SharpTask[]> {
  const output = path.resolve(job.output)
  if (job.input === undefined) return [{ source: null, output }]
  if (Array.isArray(job.input)) {
    const sources: string[] = []
    for (const file of job.input) sources.push(path.resolve(file))
    return [{ source: sources, output }]
  }
  const source = path.resolve(job.input)
  if (await isDirectory(source)) return planFolder(job, source)
  return [{ source, output }]
}

function buildPipeline(task: SharpTask, job: SharpJob): Sharp {
  const image =
    task.source === null ? sharp(job.options) : sharp(task.source, job.options)
  return applySharpOps(image, job.ops)
}

function describeSource(source: SharpTask['source']): string {
  if (source === null) return 'the generated image'
  return Array.isArray(source) ? source.join(', ') : source
}

async function runTask(
  task: SharpTask,
  job: SharpJob,
): Promise<SharpJobResult> {
  const image = buildPipeline(task, job)
  await mkdir(path.dirname(task.output), { recursive: true })
  try {
    const info = await image.toFile(task.output)
    return { source: task.source, output: task.output, info }
  } catch (error) {
    throw new SharpOperationError(
      `Processing ${describeSource(task.source)} into ${task.output} failed`,
      error,
    )
  }
}

/** Validates and runs a Sharp job; folder inputs produce one result per image. */
export async function runSharpJob(
  input: SharpJobInput,
): Promise<SharpJobResult[]> {
  const job = parseWithSchema(sharpJobSchema, input)
  applySettings(job.settings)
  const tasks = await planTasks(job)
  const results: SharpJobResult[] = []
  for (const task of tasks) results.push(await runTask(task, job))
  return results
}
