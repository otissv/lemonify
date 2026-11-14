import path from 'node:path'

import { displayPath } from '../../../src/lib/images/display-path.ts'
import {
  parseUpscaleOptions,
  upscaleOptionsSchema,
} from '../../../src/lib/images/options.ts'
import type { UpscaleOptions } from '../../../src/lib/images/options.ts'
import { upscaleImages } from '../../../src/lib/images/upscale.ts'
import type { UpscaleResult } from '../../../src/lib/images/upscale.ts'
import {
  DEFAULT_UPSCALE_MODEL,
  DEFAULT_UPSCALE_SCALE,
  MODELS_ROOT,
  UPSCALE_MODELS,
  UPSCALE_MODEL_NAMES,
  UPSCALE_SCALES,
} from '../../../src/lib/images/upscale-models.ts'
import {
  CliUsageError,
  PROGRAM,
  defineCommand,
  parseCliArgs,
  toNumber,
} from '../cli.ts'
import type { ArgsOptions, ParsedCommand } from '../cli.ts'

const MODEL_INDENT = ' '.repeat(23)

function describeModels(): string {
  const lines: string[] = []
  for (const name of UPSCALE_MODEL_NAMES) {
    lines.push(`${MODEL_INDENT}${name}: ${UPSCALE_MODELS[name].description}`)
  }
  return lines.join('\n')
}

const USAGE = `Usage: ${PROGRAM} upscale <source> <destination> [options]

Upscales <source> (a file or folder) with AI models on the GPU (Vulkan, via
Upscayl) and writes the results into <destination>, keeping names and
formats. The destination is created if missing. The chosen model is
downloaded and verified on first use. AVIF sources are not supported.

Options:
  --model <name>       ${UPSCALE_MODEL_NAMES.join(' | ')} (default ${DEFAULT_UPSCALE_MODEL})
${describeModels()}
  --scale <factor>     ${UPSCALE_SCALES.join(' | ')} (default ${DEFAULT_UPSCALE_SCALE})
  --recursive          Include subfolders and keep their structure
  -h, --help           Show this help`

const POSITIONALS = 2

const ARGS = {
  allowPositionals: true,
  strict: true,
  options: {
    model: { type: 'string' },
    scale: { type: 'string' },
    recursive: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
} as const satisfies ArgsOptions

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
    model: values.model,
    scale: toNumber(values.scale),
    recursive: values.recursive,
  })
  return { kind: 'run', options }
}

interface UpscaleRun {
  model: UpscaleOptions['model']
  scale: UpscaleOptions['scale']
  images: UpscaleResult[]
}

/** The Upscayl engine is loaded only here, so other commands never load `opencomic-ai-bin`. */
async function run(options: UpscaleOptions): Promise<UpscaleRun> {
  const { createUpscaylEngine } =
    await import('../../../src/lib/images/upscayl-engine.ts')
  const engine = await createUpscaylEngine(path.resolve(MODELS_ROOT), [
    options.model,
  ])
  try {
    const images = await upscaleImages(options, engine.upscale)
    return { model: options.model, scale: options.scale, images }
  } finally {
    engine.close()
  }
}

function format(result: UpscaleRun): string {
  const lines: string[] = []
  for (const image of result.images) {
    lines.push(`${displayPath(image.output)}: ${image.width}x${image.height}`)
  }
  lines.push(
    `Upscaled ${result.images.length} images ${result.scale}x with ${result.model}`,
  )
  return lines.join('\n')
}

export const upscaleCommand = defineCommand({
  name: 'upscale',
  summary: 'Upscale images with AI models on the GPU (Upscayl)',
  usage: USAGE,
  schema: upscaleOptionsSchema,
  parse,
  run,
  format,
})
