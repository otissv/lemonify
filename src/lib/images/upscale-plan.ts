import sharp from 'sharp'

import { fileExists } from './dry-run.ts'
import type { PlannedWrite, WritePlan } from './dry-run.ts'
import { modelInstallState } from './model-install.ts'
import type { ModelInstallState } from './model-install.ts'
import { planUpscaleJobs } from './upscale.ts'
import type { UpscaleJob } from './upscale.ts'
import { parseUpscaleOptions, resolveModel } from './upscale-options.ts'
import type { ModelChoice, UpscaleOptionsInput } from './upscale-options.ts'

/** EXIF orientations 5–8 turn the image a quarter, so width and height swap when it is made upright. */
const FIRST_QUARTER_TURN_ORIENTATION = 5

export interface PlannedUpscaleWrite extends PlannedWrite {
  /** Size after the model passes and before the Sharp `ops`, which may resize it again. */
  upscaledWidth: number
  upscaledHeight: number
}

export interface UpscalePlan extends WritePlan<PlannedUpscaleWrite> {
  model: string
  scale: number
  iterations: number
  /** Whether a catalogue model is on disk; a missing one is downloaded on the real run. */
  modelStatus: ModelInstallState | 'custom'
}

async function plannedWrite(
  job: UpscaleJob,
  factor: number,
): Promise<PlannedUpscaleWrite> {
  const { width, height, orientation = 1 } = await sharp(job.source).metadata()
  const turned = orientation >= FIRST_QUARTER_TURN_ORIENTATION
  return {
    file: job.output,
    source: job.source,
    kind: 'file',
    exists: await fileExists(job.output),
    upscaledWidth: (turned ? height : width) * factor,
    upscaledHeight: (turned ? width : height) * factor,
  }
}

function modelStatus(
  model: ModelChoice,
  modelsRoot: string,
): Promise<UpscalePlan['modelStatus']> {
  if (model.kind === 'custom') return Promise.resolve('custom')
  return modelInstallState(modelsRoot, model.model)
}

/**
 * Validates an upscale and lists every file it would read and write,
 * with the upscaled size of each, without running the model, downloading
 * it, or writing anything. Needs no GPU.
 */
export async function planUpscale(
  input: UpscaleOptionsInput,
  modelsRoot: string,
): Promise<UpscalePlan> {
  const options = parseUpscaleOptions(input)
  const { model, scale } = resolveModel(options)
  const factor = scale ** options.iterations
  const reads: string[] = []
  const writes: PlannedUpscaleWrite[] = []
  for (const job of await planUpscaleJobs(options)) {
    reads.push(job.source)
    writes.push(await plannedWrite(job, factor))
  }
  return {
    dryRun: true,
    model: model.kind === 'pinned' ? model.model.name : model.name,
    scale,
    iterations: options.iterations,
    modelStatus: await modelStatus(model, modelsRoot),
    reads,
    writes,
  }
}
