import { displayPath } from '../../../src/lib/images/display-path.ts'
import { parseWithSchema } from '../../../src/lib/images/options.ts'
import {
  runSharpJob,
  sharpJobSchema,
} from '../../../src/lib/images/sharp/job.ts'
import type {
  SharpJob,
  SharpJobResult,
} from '../../../src/lib/images/sharp/job.ts'
import { SHARP_OP_NAMES } from '../../../src/lib/images/sharp/ops.ts'
import {
  PROGRAM,
  defineCommand,
  parseCliArgs,
  readJsonArgument,
} from '../cli.ts'
import type { ArgsOptions, ParsedCommand } from '../cli.ts'

const OPS_PER_LINE = 6
const OP_INDENT = '    '
const BYTES_PER_KILOBYTE = 1024

function listOps(): string {
  const lines: string[] = []
  for (let index = 0; index < SHARP_OP_NAMES.length; index += OPS_PER_LINE) {
    const chunk = SHARP_OP_NAMES.slice(index, index + OPS_PER_LINE)
    lines.push(`${OP_INDENT}${chunk.join(', ')}`)
  }
  return lines.join('\n')
}

const USAGE = `Usage: ${PROGRAM} sharp --input <path> --output <path> [options]

Runs any Sharp pipeline. Each op is { "op": "<Sharp method>", ...arguments }:
positional arguments become named fields (rotate → angle, gamma → gamma and
gammaOut, boolean → operand and operator, …) and option objects are flattened
in. Ops run in order; the output format comes from the last format op, or
from the output file's extension.

Options:
  --input <path>       Image file, or a folder to process every image in it.
                       Repeat to pass several images for options.join.
                       Omit when options.create or options.text makes the image.
  --output <path>      Output file, or the output folder for a folder input
  --ops <json>         Array of ops (inline JSON, @file.json, or - for stdin)
  --options <json>     Input options for sharp(input, options): create, text,
                       join, raw, density, pages, animated, failOn, …
  --settings <json>    Process settings: concurrency, cache, simd, block, unblock
  --recursive          Include subfolders of a folder input
  -h, --help           Show this help

Ops:
${listOps()}

\`${PROGRAM} schema sharp\` prints the JSON Schema of every op and option.

Examples:
  ${PROGRAM} sharp --input photo.jpg --output out.webp \\
    --ops '[{"op":"resize","width":800,"fit":"cover","position":"attention"},{"op":"webp","quality":80}]'
  ${PROGRAM} sharp --output blank.png \\
    --options '{"create":{"width":64,"height":64,"channels":4,"background":"#0000"}}'`

const ARGS = {
  allowPositionals: false,
  strict: true,
  options: {
    input: { type: 'string', multiple: true },
    output: { type: 'string' },
    ops: { type: 'string' },
    options: { type: 'string' },
    settings: { type: 'string' },
    recursive: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
} as const satisfies ArgsOptions

function jsonFlag(value: string | undefined, flag: string): unknown {
  return value === undefined ? undefined : readJsonArgument(value, flag, USAGE)
}

function parse(argv: readonly string[]): ParsedCommand<SharpJob> {
  const { values } = parseCliArgs(ARGS, argv, USAGE)
  if (values.help) return { kind: 'help' }
  const inputs = values.input ?? []
  const job = parseWithSchema(sharpJobSchema, {
    input: inputs.length > 1 ? inputs : inputs[0],
    output: values.output,
    ops: jsonFlag(values.ops, '--ops'),
    options: jsonFlag(values.options, '--options'),
    settings: jsonFlag(values.settings, '--settings'),
    recursive: values.recursive,
  })
  return { kind: 'run', options: job }
}

function format(results: SharpJobResult[]): string {
  const lines: string[] = []
  for (const result of results) {
    const { width, height, format: type, size } = result.info
    const parts = [`${width}x${height}`, type]
    if (Number.isFinite(size)) {
      parts.push(`${Math.round(size / BYTES_PER_KILOBYTE)} KB`)
    }
    lines.push(`${displayPath(result.output)}: ${parts.join(', ')}`)
  }
  lines.push(`Wrote ${results.length} images`)
  return lines.join('\n')
}

export const sharpCommand = defineCommand({
  name: 'sharp',
  summary: 'Run any Sharp pipeline (every Sharp operation, as JSON ops)',
  usage: USAGE,
  schema: sharpJobSchema,
  parse,
  run: runSharpJob,
  format,
})
