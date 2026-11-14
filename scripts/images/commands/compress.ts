import { compressImages } from '../../../src/lib/images/compress.ts'
import type { CompressionResult } from '../../../src/lib/images/compress.ts'
import { displayPath } from '../../../src/lib/images/display-path.ts'
import {
  DEFAULT_MAX_WIDTH,
  compressOptionsSchema,
  parseCompressOptions,
} from '../../../src/lib/images/options.ts'
import type { CompressOptions } from '../../../src/lib/images/options.ts'
import {
  CliUsageError,
  PROGRAM,
  defineCommand,
  parseCliArgs,
  toNumber,
} from '../cli.ts'
import type { ArgsOptions, ParsedCommand } from '../cli.ts'

const USAGE = `Usage: ${PROGRAM} compress <source> [destination] [options]

Recompresses <source> (a file or folder) with Sharp, keeping names and
formats. Without a destination, files are replaced in place only when the
result is smaller. With a destination, results are written there and
originals are untouched.

Options:
  --max-width <px>     Shrink wider images to this width (default ${DEFAULT_MAX_WIDTH})
  --quality <1-100>    Encoder quality (default per format)
  --recursive          Include subfolders and keep their structure
  -h, --help           Show this help`

const MAX_POSITIONALS = 2
const BYTES_PER_KILOBYTE = 1024

const ARGS = {
  allowPositionals: true,
  strict: true,
  options: {
    'max-width': { type: 'string' },
    quality: { type: 'string' },
    recursive: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
} as const satisfies ArgsOptions

function parse(argv: readonly string[]): ParsedCommand<CompressOptions> {
  const { values, positionals } = parseCliArgs(ARGS, argv, USAGE)
  if (values.help) return { kind: 'help' }
  if (positionals.length < 1 || positionals.length > MAX_POSITIONALS) {
    throw new CliUsageError(
      'Expected a <source> and an optional [destination].',
      USAGE,
    )
  }
  const [source] = positionals
  const destination =
    positionals.length === MAX_POSITIONALS ? positionals[1] : undefined
  const options = parseCompressOptions({
    source,
    destination,
    maxWidth: toNumber(values['max-width']),
    quality: toNumber(values.quality),
    recursive: values.recursive,
  })
  return { kind: 'run', options }
}

function toKilobytes(bytes: number): string {
  return `${Math.round(bytes / BYTES_PER_KILOBYTE)} KB`
}

async function run(options: CompressOptions): Promise<CompressionResult[]> {
  return compressImages(options)
}

function format(results: CompressionResult[]): string {
  const lines: string[] = []
  let before = 0
  let after = 0
  for (const result of results) {
    before += result.before
    after += result.after
    const outcome = result.written
      ? `${toKilobytes(result.before)} -> ${toKilobytes(result.after)}`
      : 'kept (no smaller)'
    lines.push(`${displayPath(result.output)}: ${outcome}`)
  }
  lines.push(`Total: ${toKilobytes(before)} -> ${toKilobytes(after)}`)
  return lines.join('\n')
}

export const compressCommand = defineCommand({
  name: 'compress',
  summary: 'Recompress images with Sharp, in place or into a folder',
  usage: USAGE,
  schema: compressOptionsSchema,
  parse,
  run,
  format,
})
