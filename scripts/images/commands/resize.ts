import { buildImages } from '../../../src/lib/images/build.ts'
import type { BuildResult } from '../../../src/lib/images/build.ts'
import { displayPath } from '../../../src/lib/images/display-path.ts'
import {
  DEFAULT_FORMAT,
  DEFAULT_QUALITY,
  DEFAULT_WIDTHS,
  IMAGE_FORMATS,
  buildOptionsSchema,
  parseBuildOptions,
} from '../../../src/lib/images/options.ts'
import type { BuildOptions } from '../../../src/lib/images/options.ts'
import {
  CliUsageError,
  PROGRAM,
  defineCommand,
  parseCliArgs,
  toNumber,
  toNumberList,
} from '../cli.ts'
import type { ArgsOptions, ParsedCommand } from '../cli.ts'

const USAGE = `Usage: ${PROGRAM} resize <source> <destination> [options]

Writes resized copies of <source> (a file or folder) into <destination> with
Sharp, named <name>-<width>.<format>. The destination is created if missing
and nothing in it is deleted.

Options:
  --widths <list>      Comma-separated target widths (default ${DEFAULT_WIDTHS.join(',')})
  --quality <1-100>    Encoder quality (default ${DEFAULT_QUALITY})
  --format <format>    ${IMAGE_FORMATS.join(' | ')} (default ${DEFAULT_FORMAT})
  --recursive          Include subfolders and keep their structure
  --manifest <file>    Also write a JSON manifest of the variants
  -h, --help           Show this help`

const POSITIONALS = 2

const ARGS = {
  allowPositionals: true,
  strict: true,
  options: {
    widths: { type: 'string' },
    quality: { type: 'string' },
    format: { type: 'string' },
    recursive: { type: 'boolean' },
    manifest: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
} as const satisfies ArgsOptions

function parse(argv: readonly string[]): ParsedCommand<BuildOptions> {
  const { values, positionals } = parseCliArgs(ARGS, argv, USAGE)
  if (values.help) return { kind: 'help' }
  if (positionals.length !== POSITIONALS) {
    throw new CliUsageError('Expected a <source> and a <destination>.', USAGE)
  }
  const [source, destination] = positionals
  const options = parseBuildOptions({
    source,
    destination,
    widths: toNumberList(values.widths),
    quality: toNumber(values.quality),
    format: values.format,
    recursive: values.recursive,
    manifest: values.manifest,
  })
  return { kind: 'run', options }
}

interface ResizeResult {
  destination: string
  images: BuildResult[]
}

async function run(options: BuildOptions): Promise<ResizeResult> {
  return {
    destination: options.destination,
    images: await buildImages(options),
  }
}

function format(result: ResizeResult): string {
  const lines: string[] = []
  let written = 0
  for (const image of result.images) {
    const widths: number[] = []
    for (const variant of image.variants) widths.push(variant.width)
    written += widths.length
    lines.push(`${displayPath(image.source)}: ${widths.join(', ')}`)
  }
  lines.push(
    `Wrote ${written} files for ${result.images.length} images to ${displayPath(result.destination)}`,
  )
  return lines.join('\n')
}

export const resizeCommand = defineCommand({
  name: 'resize',
  summary: 'Write responsive width variants with Sharp',
  usage: USAGE,
  schema: buildOptionsSchema,
  parse,
  run,
  format,
})
