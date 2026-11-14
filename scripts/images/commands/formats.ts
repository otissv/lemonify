import { z } from 'zod'

import { describeCapabilities } from '../../../src/lib/images/sharp/capabilities.ts'
import type { Capabilities } from '../../../src/lib/images/sharp/capabilities.ts'
import { CliUsageError, PROGRAM, defineCommand, parseCliArgs } from '../cli.ts'
import type { ArgsOptions, ParsedCommand } from '../cli.ts'

const USAGE = `Usage: ${PROGRAM} formats

Lists the formats this Sharp build can read and write, the file extensions
it recognises, and the Sharp and libvips versions.

Options:
  -h, --help           Show this help`

const ID_COLUMN = 12

const ARGS = {
  allowPositionals: true,
  strict: true,
  options: { help: { type: 'boolean', short: 'h' } },
} as const satisfies ArgsOptions

const formatsOptionsSchema = z.strictObject({})
type FormatsOptions = z.output<typeof formatsOptionsSchema>

function parse(argv: readonly string[]): ParsedCommand<FormatsOptions> {
  const { values, positionals } = parseCliArgs(ARGS, argv, USAGE)
  if (values.help) return { kind: 'help' }
  if (positionals.length > 0) {
    throw new CliUsageError('This command takes no arguments.', USAGE)
  }
  return { kind: 'run', options: {} }
}

function mark(supported: boolean): string {
  return supported ? 'yes' : 'no '
}

function format(result: Capabilities): string {
  const lines = [
    `sharp ${result.versions.sharp ?? '?'}, libvips ${result.versions.vips ?? '?'}`,
    '',
    `${'format'.padEnd(ID_COLUMN)}read  write  extensions`,
  ]
  for (const entry of result.formats) {
    const read = mark(entry.input.file)
    const write = mark(entry.output.file)
    lines.push(
      `${entry.id.padEnd(ID_COLUMN)}${read}   ${write}    ${entry.input.fileSuffix.join(' ')}`,
    )
  }
  return lines.join('\n')
}

export const formatsCommand = defineCommand({
  name: 'formats',
  summary: 'List the formats and versions of this Sharp build',
  usage: USAGE,
  schema: formatsOptionsSchema,
  parse,
  run: async () => describeCapabilities(),
  format,
})
