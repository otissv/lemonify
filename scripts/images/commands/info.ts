import { displayPath } from '../../../src/lib/images/display-path.ts'
import { parseWithSchema } from '../../../src/lib/images/validation.ts'
import {
  inspectImages,
  inspectOptionsSchema,
} from '../../../src/lib/images/sharp/inspect.ts'
import type { InspectResult } from '../../../src/lib/images/sharp/inspect.ts'
import { CliUsageError, PROGRAM, defineCommand, parseCliArgs } from '../cli.ts'
import type { ArgsOptions, ParsedCommand } from '../cli.ts'

const USAGE = `Usage: ${PROGRAM} info <source> [options]

Prints the metadata Sharp reads from <source> (a file or folder): size,
format, colour space, channels, alpha, density, orientation, pages and more.
Binary blocks (EXIF, ICC, XMP) are reported as their byte size. Use --json
for every field.

Options:
  --stats              Also compute pixel statistics (per-channel min, max,
                       mean, stdev; entropy, sharpness, dominant colour)
  --recursive          Include subfolders and keep their structure
  -h, --help           Show this help`

const ARGS = {
  allowPositionals: true,
  strict: true,
  options: {
    stats: { type: 'boolean' },
    recursive: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
} as const satisfies ArgsOptions

type InspectOptions = ReturnType<typeof inspectOptionsSchema.parse>

function parse(argv: readonly string[]): ParsedCommand<InspectOptions> {
  const { values, positionals } = parseCliArgs(ARGS, argv, USAGE)
  if (values.help) return { kind: 'help' }
  if (positionals.length !== 1) {
    throw new CliUsageError('Expected one <source>.', USAGE)
  }
  const options = parseWithSchema(inspectOptionsSchema, {
    source: positionals[0],
    stats: values.stats,
    recursive: values.recursive,
  })
  return { kind: 'run', options }
}

function describe(result: InspectResult): string {
  const { width, height, space, channels, hasAlpha } = result.metadata
  const parts = [
    `${width}x${height}`,
    result.metadata.format,
    space,
    `${channels} channels`,
  ]
  if (hasAlpha) parts.push('alpha')
  if (result.stats) {
    const { r, g, b } = result.stats.dominant
    parts.push(
      `entropy ${result.stats.entropy.toFixed(2)}`,
      `sharpness ${result.stats.sharpness.toFixed(2)}`,
      `dominant rgb(${r}, ${g}, ${b})`,
    )
  }
  return `${displayPath(result.file)}: ${parts.join(', ')}`
}

function format(results: InspectResult[]): string {
  const lines: string[] = []
  for (const result of results) lines.push(describe(result))
  return lines.join('\n')
}

export const infoCommand = defineCommand({
  name: 'info',
  summary: 'Show image metadata and, with --stats, pixel statistics',
  usage: USAGE,
  schema: inspectOptionsSchema,
  parse,
  run: inspectImages,
  format,
})
