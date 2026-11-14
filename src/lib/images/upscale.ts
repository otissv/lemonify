import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

import { ImageSourceError, UpscaleTargetError } from './errors.ts'
import { parseUpscaleOptions } from './options.ts'
import type { UpscaleOptionsInput } from './options.ts'
import { mirroredPath } from './plan.ts'
import { collectSources, formatForFile } from './sources.ts'
import type { UpscaleModelName, UpscaleScale } from './upscale-models.ts'

export interface UpscaleJob {
  source: string
  output: string
  model: UpscaleModelName
  scale: UpscaleScale
}

/** Upscales one image from `job.source` to `job.output`; the output folder already exists. */
export type UpscaleEngine = (job: UpscaleJob) => Promise<void>

export interface UpscaleResult {
  source: string
  output: string
  width: number
  height: number
}

function planJobs(
  files: readonly string[],
  root: string,
  destination: string,
  settings: Pick<UpscaleJob, 'model' | 'scale'>,
): UpscaleJob[] {
  const jobs: UpscaleJob[] = []
  for (const source of files) {
    if (formatForFile(source) === 'avif') {
      throw new ImageSourceError(
        source,
        'AVIF is not supported by the upscaler; convert it to PNG, JPEG or WebP first',
      )
    }
    const output = mirroredPath(source, root, destination)
    if (output === source) throw new UpscaleTargetError(source)
    jobs.push({ source, output, ...settings })
  }
  return jobs
}

async function runJob(
  job: UpscaleJob,
  engine: UpscaleEngine,
): Promise<UpscaleResult> {
  await mkdir(path.dirname(job.output), { recursive: true })
  await engine(job)
  const { width, height } = await sharp(job.output).metadata()
  return { source: job.source, output: job.output, width, height }
}

/**
 * Upscales an image or folder of images into `destination`, keeping names,
 * formats and (with `recursive`) subfolders. Every job is planned and
 * validated before the engine runs, so a bad source fails the run early.
 */
export async function upscaleImages(
  input: UpscaleOptionsInput,
  engine: UpscaleEngine,
): Promise<UpscaleResult[]> {
  const options = parseUpscaleOptions(input)
  const source = path.resolve(options.source)
  const destination = path.resolve(options.destination)
  const sources = await collectSources(source, {
    recursive: options.recursive,
    exclude: destination,
  })
  const jobs = planJobs(sources.files, sources.root, destination, {
    model: options.model,
    scale: options.scale,
  })

  const results: UpscaleResult[] = []
  for (const job of jobs) results.push(await runJob(job, engine))
  return results
}
