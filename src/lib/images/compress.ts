import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { encodeImage, writeOutput } from './encode.ts'
import { CompressTargetError, ImageSourceError } from './errors.ts'
import { parseCompressOptions } from './options.ts'
import type {
  CompressOptions,
  CompressOptionsInput,
  ImageFormat,
} from './options.ts'
import { mirroredPath } from './plan.ts'
import { collectSources, formatForFile } from './sources.ts'

/** Per-format defaults used when no quality is given. */
export const COMPRESS_QUALITY: Readonly<Record<ImageFormat, number>> = {
  jpeg: 78,
  png: 85,
  webp: 78,
  avif: 50,
}

export interface CompressionResult {
  source: string
  output: string
  before: number
  after: number
  written: boolean
}

interface CompressJob {
  source: string
  /** Undefined for an in-place run. */
  output: string | undefined
  format: ImageFormat
}

function planJobs(
  files: readonly string[],
  root: string,
  destination: string | undefined,
): CompressJob[] {
  const jobs: CompressJob[] = []
  for (const source of files) {
    const format = formatForFile(source)
    if (!format)
      throw new ImageSourceError(source, 'it is not a supported image')
    const output =
      destination === undefined
        ? undefined
        : mirroredPath(source, root, destination)
    if (output === source) throw new CompressTargetError(source)
    jobs.push({ source, output, format })
  }
  return jobs
}

async function compressFile(
  job: CompressJob,
  options: CompressOptions,
): Promise<CompressionResult> {
  const original = await readFile(job.source)
  const before = original.byteLength
  const data = await encodeImage(
    original,
    {
      width: options.maxWidth,
      format: job.format,
      quality: options.quality ?? COMPRESS_QUALITY[job.format],
    },
    job.source,
  )
  if (job.output !== undefined) {
    await writeOutput(job.output, data)
    return {
      source: job.source,
      output: job.output,
      before,
      after: data.byteLength,
      written: true,
    }
  }
  const written = data.byteLength < before
  if (written) await writeFile(job.source, data)
  const after = written ? data.byteLength : before
  return { source: job.source, output: job.source, before, after, written }
}

/**
 * Recompresses images, keeping each file's name and format. In place, a file
 * is replaced only when the result is smaller. With a destination, every
 * result is written there and the originals are left untouched.
 */
export async function compressImages(
  input: CompressOptionsInput,
): Promise<CompressionResult[]> {
  const options = parseCompressOptions(input)
  const source = path.resolve(options.source)
  const destination =
    options.destination === undefined
      ? undefined
      : path.resolve(options.destination)
  const sources = await collectSources(source, {
    recursive: options.recursive,
    exclude: destination,
  })
  const jobs = planJobs(sources.files, sources.root, destination)

  const results: CompressionResult[] = []
  for (const job of jobs) results.push(await compressFile(job, options))
  return results
}
