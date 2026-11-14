import path from 'node:path'

import { displayPath } from '../../../src/lib/images/display-path.ts'
import { upscaleImages } from '../../../src/lib/images/upscale.ts'
import type { UpscaleResult } from '../../../src/lib/images/upscale.ts'
import { planUpscale } from '../../../src/lib/images/upscale-plan.ts'
import type { UpscalePlan } from '../../../src/lib/images/upscale-plan.ts'
import {
  parseUpscaleOptions,
  resolveModel,
  upscaleOptionsSchema,
} from '../../../src/lib/images/upscale-options.ts'
import type { UpscaleOptions } from '../../../src/lib/images/upscale-options.ts'
import {
  DEFAULT_UPSCALE_MODEL,
  MODELS_ROOT,
} from '../../../src/lib/images/upscale-models.ts'
import {
  CliUsageError,
  PROGRAM,
  defineCommand,
  parseCliArgs,
  readJsonArgument,
  toNumber,
} from '../cli.ts'
import type { ArgsOptions, ParsedCommand } from '../cli.ts'
import { formatWritePlan } from '../plan-format.ts'

const USAGE = `Usage: ${PROGRAM} upscale <source> <destination> [options]

Upscales or restores <source> (a file or folder) with an AI model on the GPU
(Vulkan, via Upscayl) and writes the results into <destination>, keeping
names. Any format Sharp reads is accepted; EXIF orientation is applied first.
The chosen model is downloaded and verified on first use.

Upscayl does only the AI step. Output format, exact size, quality and
metadata come from --ops, the same Sharp ops as \`${PROGRAM} sharp\`.

Model:
  --model <name>         Catalogue model (default ${DEFAULT_UPSCALE_MODEL}).
                         \`${PROGRAM} models\` lists all of them.
  --model-path <dir>     Use your own ncnn model from this folder instead…
  --model-name <name>    …loading <name>.param and <name>.bin
  --model-scale <n>      …which upscales by this factor
  --scale <n>            One of the model's scales (default: its largest)
  --noise <-1..3>        Denoise level, for models that offer it
  --iterations <1-3>     Run the model again on its own output (default 1)

Performance:
  --tile-size <px>       Tile size, at least 32; 0 = auto (default auto)
  --max-tile-size <px>   Cap for the automatic tile size
  --memory-percent <n>   Share of GPU memory auto tiling may plan for (1-100)
  --gpu <id>             auto, a device index, or 0,1 for several GPUs
  --threads <n>          Worker threads for load, process and save
  --tta                  Test-time augmentation: slower, slightly better
  --fp32                 Force 32-bit floating point inference

Output:
  --ops <json>           Sharp ops for the upscaled image (inline JSON,
                         @file.json, or - for stdin), e.g.
                         '[{"op":"resize","width":2000},{"op":"avif","quality":60}]'
  --recursive            Include subfolders and keep their structure
  --dry-run              List every file the upscale would read and write,
                         with upscaled sizes and whether the model is
                         installed; runs no model, downloads nothing, needs
                         no GPU
  -h, --help             Show this help`

const POSITIONALS = 2

const ARGS = {
  allowPositionals: true,
  strict: true,
  options: {
    model: { type: 'string' },
    'model-path': { type: 'string' },
    'model-name': { type: 'string' },
    'model-scale': { type: 'string' },
    scale: { type: 'string' },
    noise: { type: 'string' },
    iterations: { type: 'string' },
    'tile-size': { type: 'string' },
    'max-tile-size': { type: 'string' },
    'memory-percent': { type: 'string' },
    gpu: { type: 'string' },
    threads: { type: 'string' },
    tta: { type: 'boolean' },
    fp32: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    ops: { type: 'string' },
    recursive: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
} as const satisfies ArgsOptions

type Values = ReturnType<typeof parseCliArgs<typeof ARGS>>['values']

function customModel(values: Values): unknown {
  const directory = values['model-path']
  if (directory === undefined) {
    if (
      values['model-name'] !== undefined ||
      values['model-scale'] !== undefined
    ) {
      throw new CliUsageError(
        '--model-name and --model-scale need --model-path.',
        USAGE,
      )
    }
    return undefined
  }
  return {
    directory,
    name: values['model-name'],
    scale: toNumber(values['model-scale']),
  }
}

function parse(argv: readonly string[]): ParsedCommand<UpscaleOptions> {
  const { values, positionals } = parseCliArgs(ARGS, argv, USAGE)
  if (values.help) return { kind: 'help' }
  if (positionals.length !== POSITIONALS) {
    throw new CliUsageError('Expected a <source> and a <destination>.', USAGE)
  }
  const [source, destination] = positionals
  const options = parseUpscaleOptions({
    source,
    destination,
    recursive: values.recursive,
    model: values.model,
    customModel: customModel(values),
    scale: toNumber(values.scale),
    noise: toNumber(values.noise),
    iterations: toNumber(values.iterations),
    tileSize: toNumber(values['tile-size']),
    maxTileSize: toNumber(values['max-tile-size']),
    memorySafePercentage: toNumber(values['memory-percent']),
    gpuId: values.gpu,
    threads: toNumber(values.threads),
    tta: values.tta,
    fp32: values.fp32,
    dryRun: values['dry-run'],
    ops:
      values.ops === undefined
        ? undefined
        : readJsonArgument(values.ops, '--ops', USAGE),
  })
  return { kind: 'run', options }
}

interface UpscaleRun {
  model: string
  scale: number
  iterations: number
  images: UpscaleResult[]
}

/** The Upscayl engine is loaded only here, so other commands never load `opencomic-ai-bin`. */
async function upscale(options: UpscaleOptions): Promise<UpscaleRun> {
  const { createUpscaylEngine } =
    await import('../../../src/lib/images/upscayl-engine.ts')
  const { model, scale } = resolveModel(options)
  const engine = await createUpscaylEngine(
    path.resolve(MODELS_ROOT),
    model,
    scale,
  )
  try {
    const images = await upscaleImages(options, engine.upscale)
    const name = model.kind === 'pinned' ? model.model.name : model.name
    return { model: name, scale, iterations: options.iterations, images }
  } finally {
    engine.close()
  }
}

function run(options: UpscaleOptions): Promise<UpscaleRun | UpscalePlan> {
  if (options.dryRun) return planUpscale(options, path.resolve(MODELS_ROOT))
  return upscale(options)
}

function formatPlan(plan: UpscalePlan): string {
  const passes = plan.iterations > 1 ? `, ${plan.iterations} passes` : ''
  const header = `${plan.model} at ${plan.scale}x${passes}; model ${plan.modelStatus}`
  const body = formatWritePlan(
    plan,
    (write) => `upscaled to ${write.upscaledWidth}x${write.upscaledHeight}`,
  )
  return `${header}\n${body}`
}

function formatRun(result: UpscaleRun): string {
  const lines: string[] = []
  for (const image of result.images) {
    lines.push(`${displayPath(image.output)}: ${image.width}x${image.height}`)
  }
  const passes = result.iterations > 1 ? `, ${result.iterations} passes` : ''
  lines.push(
    `Upscaled ${result.images.length} images ${result.scale}x with ${result.model}${passes}`,
  )
  return lines.join('\n')
}

function format(outcome: UpscaleRun | UpscalePlan): string {
  return 'dryRun' in outcome ? formatPlan(outcome) : formatRun(outcome)
}

export const upscaleCommand = defineCommand({
  name: 'upscale',
  summary: 'Upscale or restore images with AI models on the GPU (Upscayl)',
  usage: USAGE,
  schema: upscaleOptionsSchema,
  parse,
  run,
  format,
})
