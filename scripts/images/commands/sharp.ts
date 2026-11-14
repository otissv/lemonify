import { displayPath } from '../../../src/lib/images/display-path.ts'
import { parseWithSchema } from '../../../src/lib/images/validation.ts'
import type { WritePlan } from '../../../src/lib/images/dry-run.ts'
import {
  planSharpJob,
  runSharpJob,
  sharpJobSchema,
} from '../../../src/lib/images/sharp/job.ts'
import type {
  SharpJob,
  SharpJobOutput,
  SharpJobResult,
} from '../../../src/lib/images/sharp/job.ts'
import { SHARP_OP_NAMES } from '../../../src/lib/images/sharp/ops.ts'
import {
  CliUsageError,
  PROGRAM,
  defineCommand,
  parseCliArgs,
  readJsonArgument,
  toNumberList,
} from '../cli.ts'
import type { ArgsOptions, ParsedCommand } from '../cli.ts'
import { formatWritePlan } from '../plan-format.ts'

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

const USAGE = `Usage: ${PROGRAM} sharp --input <path> (--output <path> | --in-place <mode>) [options]

Runs any Sharp pipeline. Each op is { "op": "<Sharp method>", ...arguments }:
positional arguments become named fields (rotate → angle, gamma → gamma and
gammaOut, boolean → operand and operator, …) and option objects are flattened
in. Sharp runs ops in its own fixed pipeline order, not the order given, and a
repeated op replaces the earlier one. The output format comes from the last
format op, or from the output file's extension.

Options:
  --input <path>       Image file, or a folder to process every image in it.
                       Repeat to pass several images for options.join.
                       Omit when options.create or options.text makes the image.
  --output <path>      Output file, or the output folder for a folder input
                       or --widths
  --in-place <mode>    Overwrite each source in its own format instead of
                       writing to --output: always, or ifSmaller to keep the
                       original unless the result is smaller
  --widths <list>      Comma-separated widths; writes <name>-<width>.<ext> per
                       width after the ops, never enlarging
  --manifest <file>    With --widths, write a JSON manifest of every source's
                       size and variants
  --ops <json>         Array of ops (inline JSON, @file.json, or - for stdin)
  --format-options <json>
                       Encoder options per format, used for whichever format
                       each output is written in, e.g. {"jpeg":{"quality":78}}
  --options <json>     Input options for sharp(input, options): create, text,
                       join, raw, density, pages, animated, failOn, …
  --settings <json>    Process settings: concurrency, cache, simd, block, unblock
  --recursive          Include subfolders of a folder input
  --dry-run            List every file the job would read and write (and
                       which already exist) without writing anything
  -h, --help           Show this help

Ops:
${listOps()}

\`${PROGRAM} schema sharp\` prints the JSON Schema of every op and option.

Examples:
  ${PROGRAM} sharp --input photo.jpg --output out.webp \\
    --ops '[{"op":"resize","width":800,"fit":"cover","position":"attention"},{"op":"webp","quality":80}]'
  ${PROGRAM} sharp --input photos --output public/images --recursive \\
    --widths 640,1280,1920 --manifest public/images/manifest.json \\
    --ops '[{"op":"autoOrient"},{"op":"webp","quality":80}]'
  ${PROGRAM} sharp --input photos --in-place ifSmaller --recursive \\
    --format-options '{"jpeg":{"quality":78,"mozjpeg":true},"png":{"palette":true}}'
  ${PROGRAM} sharp --output blank.png \\
    --options '{"create":{"width":64,"height":64,"channels":4,"background":"#0000"}}'`

const ARGS = {
  allowPositionals: false,
  strict: true,
  options: {
    input: { type: 'string', multiple: true },
    output: { type: 'string' },
    'in-place': { type: 'string' },
    widths: { type: 'string' },
    manifest: { type: 'string' },
    ops: { type: 'string' },
    'format-options': { type: 'string' },
    options: { type: 'string' },
    settings: { type: 'string' },
    recursive: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
} as const satisfies ArgsOptions

function jsonFlag(value: string | undefined, flag: string): unknown {
  return value === undefined ? undefined : readJsonArgument(value, flag, USAGE)
}

function variantsFlag(
  widths: string | undefined,
  manifest: string | undefined,
): { widths: number[] | undefined; manifest: string | undefined } | undefined {
  if (widths === undefined && manifest !== undefined)
    throw new CliUsageError('--manifest needs --widths.', USAGE)
  if (widths === undefined) return undefined
  return { widths: toNumberList(widths), manifest }
}

function parse(argv: readonly string[]): ParsedCommand<SharpJob> {
  const { values } = parseCliArgs(ARGS, argv, USAGE)
  if (values.help) return { kind: 'help' }
  const inputs = values.input ?? []
  const job = parseWithSchema(sharpJobSchema, {
    input: inputs.length > 1 ? inputs : inputs[0],
    output: values.output,
    inPlace: values['in-place'],
    variants: variantsFlag(values.widths, values.manifest),
    ops: jsonFlag(values.ops, '--ops'),
    formatOptions: jsonFlag(values['format-options'], '--format-options'),
    options: jsonFlag(values.options, '--options'),
    settings: jsonFlag(values.settings, '--settings'),
    recursive: values.recursive,
    dryRun: values['dry-run'],
  })
  return { kind: 'run', options: job }
}

function describeOutput(output: SharpJobOutput): string {
  const { width, height, format: type, size } = output.info
  const parts = [`${width}x${height}`, type]
  if (Number.isFinite(size))
    parts.push(`${Math.round(size / BYTES_PER_KILOBYTE)} KB`)
  if (!output.written) parts.push('not smaller, kept the original')
  return `${displayPath(output.file)}: ${parts.join(', ')}`
}

function formatResults(results: SharpJobResult[]): string {
  const lines: string[] = []
  let written = 0
  let kept = 0
  for (const result of results) {
    for (const output of result.outputs) {
      lines.push(describeOutput(output))
      if (output.written) written += 1
      else kept += 1
    }
  }
  lines.push(
    kept === 0
      ? `Wrote ${written} files`
      : `Wrote ${written} files, kept ${kept}`,
  )
  return lines.join('\n')
}

type SharpOutcome = SharpJobResult[] | WritePlan

function run(job: SharpJob): Promise<SharpOutcome> {
  return job.dryRun ? planSharpJob(job) : runSharpJob(job)
}

function format(outcome: SharpOutcome): string {
  return Array.isArray(outcome)
    ? formatResults(outcome)
    : formatWritePlan(outcome)
}

export const sharpCommand = defineCommand({
  name: 'sharp',
  summary: 'Run any Sharp pipeline (every Sharp operation, as JSON ops)',
  usage: USAGE,
  schema: sharpJobSchema,
  parse,
  run,
  format,
})
