import path from 'node:path'
import { z } from 'zod'

import { ImageOptionsError } from '../../../src/lib/images/errors.ts'
import {
  installModels,
  modelInstallState,
} from '../../../src/lib/images/model-install.ts'
import type { ModelInstallState } from '../../../src/lib/images/model-install.ts'
import { parseWithSchema } from '../../../src/lib/images/options.ts'
import {
  MODELS_ROOT,
  MODEL_CATEGORIES,
  findModel,
  modelManifest,
  modelNames,
} from '../../../src/lib/images/upscale-models.ts'
import type {
  ModelCategory,
  PinnedModel,
} from '../../../src/lib/images/upscale-models.ts'
import { PROGRAM, defineCommand, parseCliArgs } from '../cli.ts'
import type { ArgsOptions, ParsedCommand } from '../cli.ts'

const BYTES_PER_MEGABYTE = 1_000_000
const NAME_COLUMN = 52
const CATEGORY_COLUMN = 18
const SCALES_COLUMN = 10

const USAGE = `Usage: ${PROGRAM} models [options]

Lists every model \`${PROGRAM} upscale\` can run: AI upscalers and 1x
restoration models (${MODEL_CATEGORIES.join(', ')}), with their scales,
denoise levels, download size and whether they are installed in
${MODELS_ROOT}. Each file is pinned by SHA-256.

Options:
  --category <name>    Only list one category
  --install <name>     Download and verify a model; repeat for several
  --install-all        Download and verify every model (about 1.4 GB)
  -h, --help           Show this help`

const ARGS = {
  allowPositionals: false,
  strict: true,
  options: {
    category: { type: 'string' },
    install: { type: 'string', multiple: true },
    'install-all': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
} as const satisfies ArgsOptions

const modelsOptionsSchema = z
  .strictObject({
    category: z.enum(MODEL_CATEGORIES).optional(),
    install: z.array(z.enum(modelNames())).min(1).optional(),
    installAll: z.boolean().default(false),
  })
  .refine((options) => !(options.installAll && options.install), {
    error: 'Use either install or installAll',
  })
type ModelsOptions = z.output<typeof modelsOptionsSchema>

function parse(argv: readonly string[]): ParsedCommand<ModelsOptions> {
  const { values } = parseCliArgs(ARGS, argv, USAGE)
  if (values.help) return { kind: 'help' }
  const options = parseWithSchema(modelsOptionsSchema, {
    category: values.category,
    install: values.install,
    installAll: values['install-all'],
  })
  return { kind: 'run', options }
}

interface ModelEntry {
  name: string
  category: ModelCategory
  source: PinnedModel['source']
  description: string
  scales: number[]
  noise: number[] | null
  bytes: number
  state: ModelInstallState
}

function selectedForInstall(options: ModelsOptions): PinnedModel[] {
  if (options.installAll) return modelManifest().models
  const models: PinnedModel[] = []
  for (const name of options.install ?? []) {
    const model = findModel(name)
    if (!model) throw new ImageOptionsError([`install: unknown model ${name}`])
    models.push(model)
  }
  return models
}

async function describeModel(
  root: string,
  model: PinnedModel,
): Promise<ModelEntry> {
  let bytes = 0
  for (const file of model.files) bytes += file.bytes
  return {
    name: model.name,
    category: model.category,
    source: model.source,
    description: model.description,
    scales: model.scales,
    noise: model.noise,
    bytes,
    state: await modelInstallState(root, model),
  }
}

async function run(options: ModelsOptions): Promise<ModelEntry[]> {
  const root = path.resolve(MODELS_ROOT)
  await installModels(root, selectedForInstall(options))
  const entries: ModelEntry[] = []
  for (const model of modelManifest().models) {
    if (options.category && model.category !== options.category) continue
    entries.push(await describeModel(root, model))
  }
  return entries
}

function format(entries: ModelEntry[]): string {
  const lines = [
    `${'model'.padEnd(NAME_COLUMN)}${'category'.padEnd(CATEGORY_COLUMN)}${'scales'.padEnd(SCALES_COLUMN)}size     state`,
  ]
  for (const entry of entries) {
    const megabytes = `${(entry.bytes / BYTES_PER_MEGABYTE).toFixed(1)} MB`
    lines.push(
      `${entry.name.padEnd(NAME_COLUMN)}${entry.category.padEnd(CATEGORY_COLUMN)}${entry.scales.join('/').padEnd(SCALES_COLUMN)}${megabytes.padEnd(9)}${entry.state}`,
    )
  }
  return lines.join('\n')
}

export const modelsCommand = defineCommand({
  name: 'models',
  summary: 'List the upscale models, or download and verify them',
  usage: USAGE,
  schema: modelsOptionsSchema,
  parse,
  run,
  format,
})
