import path from 'node:path'
import { z } from 'zod'

import { installUpscaleModels } from '../../../src/lib/images/model-install.ts'
import type { InstalledModelFile } from '../../../src/lib/images/model-install.ts'
import {
  MODELS_ROOT,
  UPSCALE_MODEL_NAMES,
} from '../../../src/lib/images/upscale-models.ts'
import { CliUsageError, PROGRAM, defineCommand, parseCliArgs } from '../cli.ts'
import type { ArgsOptions, ParsedCommand } from '../cli.ts'

const USAGE = `Usage: ${PROGRAM} models

Downloads and verifies every pinned upscale model (${UPSCALE_MODEL_NAMES.join(', ')})
into ${MODELS_ROOT}. Files already present with the right checksum are
skipped. \`${PROGRAM} upscale\` also installs the model it needs, so this is
only for fetching them ahead of time.

Options:
  -h, --help           Show this help`

const ARGS = {
  allowPositionals: true,
  strict: true,
  options: {
    help: { type: 'boolean', short: 'h' },
  },
} as const satisfies ArgsOptions

const modelsOptionsSchema = z.strictObject({})
type ModelsOptions = z.output<typeof modelsOptionsSchema>

function parse(argv: readonly string[]): ParsedCommand<ModelsOptions> {
  const { values, positionals } = parseCliArgs(ARGS, argv, USAGE)
  if (values.help) return { kind: 'help' }
  if (positionals.length > 0) {
    throw new CliUsageError('This command takes no arguments.', USAGE)
  }
  return { kind: 'run', options: {} }
}

interface ModelsResult {
  directory: string
  files: InstalledModelFile[]
}

async function run(): Promise<ModelsResult> {
  const directory = path.resolve(MODELS_ROOT)
  return {
    directory,
    files: await installUpscaleModels(directory, UPSCALE_MODEL_NAMES),
  }
}

function format(result: ModelsResult): string {
  let downloaded = 0
  for (const file of result.files) if (file.downloaded) downloaded++
  return `Upscale models ready in ${MODELS_ROOT} (${downloaded} downloaded, ${result.files.length - downloaded} already verified)`
}

export const modelsCommand = defineCommand({
  name: 'models',
  summary: 'Download and verify the upscale models ahead of time',
  usage: USAGE,
  schema: modelsOptionsSchema,
  parse,
  run,
  format,
})
