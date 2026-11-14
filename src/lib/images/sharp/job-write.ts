import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { OutputInfo, Sharp } from 'sharp'

import type { ManifestSource } from '../manifest.ts'
import { planWidths, variantPath } from '../plan.ts'
import { SharpOperationError } from './errors.ts'
import { formatForFile } from './formats.ts'
import type { FileTask, InPlaceTask, VariantTask } from './job-plan.ts'
import type { FormatOptions, SharpJob } from './job-schema.ts'
import { applySharpOps, opsFormat } from './ops.ts'
import type { OutputFormat } from './output-options.ts'

export interface SharpJobOutput {
  file: string
  /** False when `inPlace: 'ifSmaller'` kept the original because the result was not smaller. */
  written: boolean
  info: OutputInfo
}

export interface SharpJobResult {
  /** The input file, the joined files, or null for a generated image. */
  source: string | string[] | null
  /** Size of a single source file; null for joined or generated images. */
  sourceBytes: number | null
  outputs: SharpJobOutput[]
}

/** A variant task's result plus what its manifest entry needs. */
export interface VariantResult {
  result: SharpJobResult
  manifest: ManifestSource
}

function describeSource(source: FileTask['source']): string {
  if (source === null) return 'the generated image'
  return Array.isArray(source) ? source.join(', ') : source
}

async function guard<T>(
  work: Promise<T>,
  source: FileTask['source'],
  target: string,
): Promise<T> {
  try {
    return await work
  } catch (error) {
    throw new SharpOperationError(
      `Processing ${describeSource(source)} into ${target} failed`,
      error,
    )
  }
}

function openInput(source: FileTask['source'], job: SharpJob): Sharp {
  return source === null ? sharp(job.options) : sharp(source, job.options)
}

async function fileBytes(source: FileTask['source']): Promise<number | null> {
  if (typeof source !== 'string') return null
  return (await stat(source)).size
}

/** Selects the output format with its `formatOptions` before the ops, so a format op's own fields win. */
function selectFormat(
  image: Sharp,
  format: OutputFormat | undefined,
  options: FormatOptions | undefined,
): Sharp {
  if (format === undefined) return image
  return image.toFormat(format, options?.[format] ?? {})
}

function targetFormat(file: string, job: SharpJob): OutputFormat | undefined {
  return opsFormat(job.ops) ?? formatForFile(file)
}

export async function writeFileTask(
  task: FileTask,
  job: SharpJob,
): Promise<SharpJobResult> {
  const format = targetFormat(task.output, job)
  const image = applySharpOps(
    selectFormat(openInput(task.source, job), format, job.formatOptions),
    job.ops,
  )
  await mkdir(path.dirname(task.output), { recursive: true })
  const info = await guard(image.toFile(task.output), task.source, task.output)
  return {
    source: task.source,
    sourceBytes: await fileBytes(task.source),
    outputs: [{ file: task.output, written: true, info }],
  }
}

async function replaceFile(file: string, data: Buffer): Promise<void> {
  const partial = `${file}.part`
  await writeFile(partial, data)
  await rename(partial, file)
}

export async function writeInPlaceTask(
  task: InPlaceTask,
  job: SharpJob,
): Promise<SharpJobResult> {
  const sourceBytes = (await stat(task.source)).size
  const format = targetFormat(task.source, job)
  const image = applySharpOps(
    selectFormat(openInput(task.source, job), format, job.formatOptions),
    job.ops,
  )
  const { data, info } = await guard(
    image.toBuffer({ resolveWithObject: true }),
    task.source,
    task.source,
  )
  const written = job.inPlace === 'always' || data.byteLength < sourceBytes
  if (written) await replaceFile(task.source, data)
  return {
    source: task.source,
    sourceBytes,
    outputs: [{ file: task.source, written, info }],
  }
}

/**
 * Runs the pixel ops once into a lossless TIFF that keeps metadata and
 * pages, then resizes that for each width and applies the output ops.
 * Two stages are needed because Sharp keeps only one resize per pipeline.
 */
async function renderPixels(
  task: VariantTask,
  job: SharpJob,
): Promise<{ data: Buffer; info: OutputInfo }> {
  const pixels = applySharpOps(openInput(task.source, job), job.ops, 'pixels')
  const intermediate = pixels.keepMetadata().tiff({ compression: 'none' })
  return guard(
    intermediate.toBuffer({ resolveWithObject: true }),
    task.source,
    task.destination,
  )
}

function variantFile(task: VariantTask, width: number): string {
  return variantPath({
    sourceFile: task.source,
    sourceRoot: task.root,
    destination: task.destination,
    width,
    extension: task.extension,
  })
}

/** The variant files a task would write, sized from the image the pixel ops produce. Writes nothing. */
export async function plannedVariantFiles(
  task: VariantTask,
  job: SharpJob,
  widths: readonly number[],
): Promise<string[]> {
  const pixels = applySharpOps(openInput(task.source, job), job.ops, 'pixels')
  const { info } = await guard(
    pixels.raw().toBuffer({ resolveWithObject: true }),
    task.source,
    task.destination,
  )
  const files: string[] = []
  for (const width of planWidths(info.width, widths))
    files.push(variantFile(task, width))
  return files
}

async function writeVariant(
  task: VariantTask,
  job: SharpJob,
  data: Buffer,
  width: number,
): Promise<SharpJobOutput> {
  const file = variantFile(task, width)
  const resized = sharp(data, { pages: -1, limitInputPixels: false }).resize({
    width,
  })
  const image = applySharpOps(
    selectFormat(resized, targetFormat(file, job), job.formatOptions),
    job.ops,
    'output',
  )
  await mkdir(path.dirname(file), { recursive: true })
  return {
    file,
    written: true,
    info: await guard(image.toFile(file), task.source, file),
  }
}

export async function writeVariantTask(
  task: VariantTask,
  job: SharpJob,
  widths: readonly number[],
): Promise<VariantResult> {
  const { data, info } = await renderPixels(task, job)
  const outputs: SharpJobOutput[] = []
  for (const width of planWidths(info.width, widths))
    outputs.push(await writeVariant(task, job, data, width))
  const height = info.pageHeight ?? info.height
  const variants: ManifestSource['variants'] = outputs.map((output) => ({
    file: output.file,
    width: output.info.width,
  }))
  return {
    result: {
      source: task.source,
      sourceBytes: await fileBytes(task.source),
      outputs,
    },
    manifest: { source: task.source, width: info.width, height, variants },
  }
}
