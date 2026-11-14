import { z } from 'zod'

import { ImageOptionsError } from '../../../src/lib/images/errors.ts'
import {
  CliUsageError,
  JOB_FLAG,
  PROGRAM,
  defineCommand,
  parseCliArgs,
} from '../cli.ts'
import type { ArgsOptions, ImageCommand, ParsedCommand } from '../cli.ts'
import { COMMANDS } from './index.ts'

const USAGE = `Usage: ${PROGRAM} schema [command]

Prints the JSON Schema (draft 2020-12) of the options object each command
accepts through ${JOB_FLAG}, keyed by command name, or of one command. GUIs
and agents can build forms or validate jobs from it.

Options:
  -h, --help           Show this help`

const ARGS = {
  allowPositionals: true,
  strict: true,
  options: { help: { type: 'boolean', short: 'h' } },
} as const satisfies ArgsOptions

const schemaOptionsSchema = z.strictObject({
  command: z.string().min(1).optional(),
})
type SchemaOptions = z.output<typeof schemaOptionsSchema>

function commandNames(): string[] {
  const names: string[] = []
  for (const command of COMMANDS) names.push(command.name)
  return names
}

function checkCommand(options: SchemaOptions): SchemaOptions {
  if (
    options.command === undefined ||
    commandNames().includes(options.command)
  ) {
    return options
  }
  throw new ImageOptionsError([
    `command: must be one of ${commandNames().join(', ')}`,
  ])
}

function parse(argv: readonly string[]): ParsedCommand<SchemaOptions> {
  const { values, positionals } = parseCliArgs(ARGS, argv, USAGE)
  if (values.help) return { kind: 'help' }
  if (positionals.length > 1) {
    throw new CliUsageError('Expected at most one [command].', USAGE)
  }
  return { kind: 'run', options: checkCommand({ command: positionals[0] }) }
}

function toJsonSchema(command: ImageCommand): unknown {
  return z.toJSONSchema(command.schema, {
    io: 'input',
    unrepresentable: 'any',
    reused: 'ref',
  })
}

async function run(options: SchemaOptions): Promise<unknown> {
  const { command } = checkCommand(options)
  const schemas: Record<string, unknown> = {}
  for (const entry of COMMANDS) {
    if (command === undefined || entry.name === command) {
      schemas[entry.name] = toJsonSchema(entry)
    }
  }
  return command === undefined ? schemas : schemas[command]
}

export const schemaCommand = defineCommand({
  name: 'schema',
  summary: `Print the JSON Schema of each command's ${JOB_FLAG} options`,
  usage: USAGE,
  schema: schemaOptionsSchema,
  parse,
  run,
  format: (result) => JSON.stringify(result, null, 2),
})
