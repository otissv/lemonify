import { stat } from 'node:fs/promises'
import path from 'node:path'

import { ImageOptionsError, OutputCollisionError } from '../errors.ts'
import { mirroredPath } from '../plan.ts'
import { collectSources } from '../sources.ts'
import { readableExtensions } from './capabilities.ts'
import { InPlaceFormatError, SharpTargetError } from './errors.ts'
import { formatForFile, rewritableExtensions } from './formats.ts'
import type { SharpJob } from './job-schema.ts'
import { formatExtension, opsFormat } from './ops.ts'

/** Writes one image to one file. */
export interface FileTask {
  kind: 'file'
  /** The input file, the joined files, or null for a generated image. */
  source: string | string[] | null
  output: string
}

/** Rewrites a source file in its own format. */
export interface InPlaceTask {
  kind: 'inPlace'
  source: string
}

/** Writes one file per width under `destination`, mirroring `root`. */
export interface VariantTask {
  kind: 'variants'
  source: string
  root: string
  destination: string
  extension: string
}

export type SharpTask = FileTask | InPlaceTask | VariantTask

async function isDirectory(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isDirectory()
  } catch {
    return false
  }
}

function withExtension(file: string, extension: string): string {
  const { dir, name } = path.parse(file)
  return path.join(dir, `${name}${extension}`)
}

/** Remembers which source claimed each output name and refuses a second claim. */
function claimOutput(
  claims: Map<string, string>,
  output: string,
  source: string,
): void {
  const first = claims.get(output)
  if (first !== undefined) throw new OutputCollisionError(output, first, source)
  claims.set(output, source)
}

async function planInPlace(job: SharpJob, input: string): Promise<SharpTask[]> {
  const sources = await collectSources(input, {
    recursive: job.recursive,
    extensions: rewritableExtensions(),
  })
  const requested = opsFormat(job.ops)
  const tasks: SharpTask[] = []
  for (const source of sources.files) {
    const current = formatForFile(source)
    if (
      requested !== undefined &&
      current !== undefined &&
      requested !== current
    )
      throw new InPlaceFormatError(source, current, requested)
    tasks.push({ kind: 'inPlace', source })
  }
  return tasks
}

function sourceTask(
  job: SharpJob,
  source: string,
  stem: string,
  roots: { root: string; destination: string },
): SharpTask {
  if (job.variants)
    return { kind: 'variants', source, ...roots, extension: path.extname(stem) }
  if (stem === source) throw new SharpTargetError(source)
  return { kind: 'file', source, output: stem }
}

async function planSources(
  job: SharpJob,
  input: string,
  output: string,
): Promise<SharpTask[]> {
  const sources = await collectSources(input, {
    recursive: job.recursive,
    exclude: output,
    extensions: readableExtensions(),
  })
  const extension = formatExtension(job.ops)
  const roots = { root: sources.root, destination: output }
  const claims = new Map<string, string>()
  const tasks: SharpTask[] = []
  for (const source of sources.files) {
    const mirrored = mirroredPath(source, sources.root, output)
    const stem = withExtension(mirrored, extension ?? path.extname(source))
    claimOutput(claims, stem, source)
    tasks.push(sourceTask(job, source, stem, roots))
  }
  return tasks
}

function requireOutput(job: SharpJob): string {
  if (job.output === undefined)
    throw new ImageOptionsError(['Provide output, or set inPlace'])
  return path.resolve(job.output)
}

/** Expands a validated job into the files it reads and writes, refusing clashing outputs up front. */
export async function planTasks(job: SharpJob): Promise<SharpTask[]> {
  if (typeof job.input === 'string' && job.inPlace)
    return planInPlace(job, path.resolve(job.input))
  const output = requireOutput(job)
  if (job.input === undefined) return [{ kind: 'file', source: null, output }]
  if (Array.isArray(job.input)) {
    const sources: string[] = []
    for (const file of job.input) sources.push(path.resolve(file))
    return [{ kind: 'file', source: sources, output }]
  }
  const input = path.resolve(job.input)
  if (!job.variants && !(await isDirectory(input)))
    return [{ kind: 'file', source: input, output }]
  return planSources(job, input, output)
}
