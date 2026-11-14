import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

import { UpscaleTargetError } from './errors.ts'
import { mirroredPath } from './plan.ts'
import { readableExtensions } from './sharp/capabilities.ts'
import { SharpOperationError } from './sharp/errors.ts'
import { applySharpOps, formatExtension } from './sharp/ops.ts'
import type { SharpOp } from './sharp/ops.ts'
import { collectSources } from './sources.ts'
import { parseUpscaleOptions, resolveModel } from './upscale-options.ts'
import type {
  ModelChoice,
  UpscaleOptions,
  UpscaleOptionsInput,
} from './upscale-options.ts'

/** What `upscayl-bin` can read directly; anything else is converted to PNG first. */
const AI_INPUT_EXTENSIONS: readonly string[] = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
]
const UPRIGHT = 1

/** One run of the AI model: `input` to the lossless PNG `output`. */
export interface AiPass {
  input: string
  output: string
  model: ModelChoice
  scale: number
  noise?: UpscaleOptions['noise']
  tileSize?: number
  maxTileSize?: number
  memorySafePercentage?: number
  gpuId?: string
  threads?: number
  tta: boolean
  fp32: boolean
}

export type UpscaleEngine = (pass: AiPass) => Promise<void>

export interface UpscaleResult {
  source: string
  output: string
  width: number
  height: number
}

type PassSettings = Omit<AiPass, 'input' | 'output'>

interface UpscaleJob {
  source: string
  output: string
}

function planJobs(
  files: readonly string[],
  root: string,
  destination: string,
  ops: readonly SharpOp[],
): UpscaleJob[] {
  const extension = formatExtension(ops)
  const jobs: UpscaleJob[] = []
  for (const source of files) {
    const mirrored = mirroredPath(source, root, destination)
    const output = extension
      ? path.join(
          path.dirname(mirrored),
          `${path.parse(mirrored).name}${extension}`,
        )
      : mirrored
    if (output === source) throw new UpscaleTargetError(source)
    jobs.push({ source, output })
  }
  return jobs
}

/** Returns a file `upscayl-bin` reads correctly: the source, or an upright PNG copy. */
async function prepareInput(source: string, workDir: string): Promise<string> {
  const readable = AI_INPUT_EXTENSIONS.includes(
    path.extname(source).toLowerCase(),
  )
  const { orientation } = await sharp(source).metadata()
  if (readable && (orientation ?? UPRIGHT) === UPRIGHT) return source
  const converted = path.join(workDir, 'input.png')
  await sharp(source).autoOrient().png().toFile(converted)
  return converted
}

async function writeOutput(
  upscaled: string,
  job: UpscaleJob,
  ops: readonly SharpOp[],
): Promise<UpscaleResult> {
  await mkdir(path.dirname(job.output), { recursive: true })
  try {
    const info = await applySharpOps(sharp(upscaled), ops).toFile(job.output)
    return { ...job, width: info.width, height: info.height }
  } catch (error) {
    if (error instanceof SharpOperationError) throw error
    throw new SharpOperationError(`Writing ${job.output} failed`, error)
  }
}

async function runJob(
  job: UpscaleJob,
  options: UpscaleOptions,
  settings: PassSettings,
  engine: UpscaleEngine,
): Promise<UpscaleResult> {
  const workDir = await mkdtemp(path.join(tmpdir(), 'lemonify-upscale-'))
  try {
    let current = await prepareInput(job.source, workDir)
    for (let pass = 0; pass < options.iterations; pass++) {
      const output = path.join(workDir, `pass-${pass}.png`)
      await engine({ ...settings, input: current, output })
      current = output
    }
    return await writeOutput(current, job, options.ops)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

function passSettings(options: UpscaleOptions): PassSettings {
  const { model, scale } = resolveModel(options)
  return {
    model,
    scale,
    noise: options.noise,
    tileSize: options.tileSize,
    maxTileSize: options.maxTileSize,
    memorySafePercentage: options.memorySafePercentage,
    gpuId: options.gpuId,
    threads: options.threads,
    tta: options.tta,
    fp32: options.fp32,
  }
}

/**
 * Upscales an image or folder into `destination`: each source is made
 * readable for `upscayl-bin` (converted and oriented when needed), run
 * through the model `iterations` times, then written through the Sharp
 * `ops`, which decide the output format, size and metadata.
 */
export async function upscaleImages(
  input: UpscaleOptionsInput,
  engine: UpscaleEngine,
): Promise<UpscaleResult[]> {
  const options = parseUpscaleOptions(input)
  const destination = path.resolve(options.destination)
  const sources = await collectSources(path.resolve(options.source), {
    recursive: options.recursive,
    exclude: destination,
    extensions: readableExtensions(),
  })
  const jobs = planJobs(sources.files, sources.root, destination, options.ops)
  const settings = passSettings(options)
  const results: UpscaleResult[] = []
  for (const job of jobs)
    results.push(await runJob(job, options, settings, engine))
  return results
}
