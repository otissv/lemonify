import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import type { z } from 'zod'

import { ImageOptionsError } from '../../src/lib/images/errors.ts'
import { ERROR_REPORTING, isAppError } from '../../src/server/errors.ts'
import { parseWithSchema } from '../../src/lib/images/validation.ts'

export const PROGRAM = 'pnpm images'
export const JOB_FLAG = '--job'
export const JSON_FLAG = '--json'
export const PROGRESS_FLAG = '--progress'
export const PROGRESS_EVENT = 'progress'
const STDIN_FD = 0

export class CliUsageError extends Error {
  readonly usage: string

  constructor(message: string, usage: string) {
    super(message)
    this.name = 'CliUsageError'
    this.usage = usage
  }
}

export type ParsedCommand<TOptions> =
  | { kind: 'help' }
  | { kind: 'run'; options: TOptions }

export interface CommandContext {
  /** Print one JSON document instead of human-readable lines. */
  json: boolean
  /** Write progress to stderr as JSON lines while the command runs. */
  progress: boolean
}

/** What a running command may report back. */
export interface RunContext {
  /** The share of the work done, from 0 to 1; only set with `--progress`. */
  onProgress?: (fraction: number) => void
}

function writeProgress(fraction: number): void {
  process.stderr.write(
    `${JSON.stringify({ event: PROGRESS_EVENT, fraction })}\n`,
  )
}

/** What `pnpm images` needs to list, describe and run a subcommand. */
export interface ImageCommand {
  name: string
  /** One line shown in the overall help. */
  summary: string
  usage: string
  /** Zod schema of the options object accepted through `--job`. */
  schema: z.ZodType
  execute: (argv: readonly string[], context: CommandContext) => Promise<void>
}

export interface CommandDefinition<TSchema extends z.ZodType, TResult> {
  name: string
  summary: string
  usage: string
  schema: TSchema
  /** Maps command-line flags to validated options. */
  parse: (argv: readonly string[]) => ParsedCommand<z.output<TSchema>>
  run: (options: z.output<TSchema>, context: RunContext) => Promise<TResult>
  /** Human-readable rendering of the result; `--json` prints the result itself. */
  format: (result: TResult) => string
}

export type DefinedCommand<
  TSchema extends z.ZodType,
  TResult,
> = CommandDefinition<TSchema, TResult> &
  ImageCommand & {
    /** Options from `--job <json>` when given, otherwise from the flags. */
    resolve: (argv: readonly string[]) => ParsedCommand<z.output<TSchema>>
  }

/** Reads a JSON flag value: inline JSON, `@path/to/file.json`, or `-` for stdin. */
export function readJsonArgument(
  value: string,
  flag: string,
  usage: string,
): unknown {
  let text = value
  try {
    if (value === '-') text = readFileSync(STDIN_FD, 'utf8')
    else if (value.startsWith('@')) text = readFileSync(value.slice(1), 'utf8')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new CliUsageError(`${flag}: cannot read ${value} (${reason})`, usage)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new CliUsageError(`${flag}: invalid JSON (${reason})`, usage)
  }
}

function jobValue(argv: readonly string[], usage: string): string | undefined {
  const index = argv.findIndex(
    (arg) => arg === JOB_FLAG || arg.startsWith(`${JOB_FLAG}=`),
  )
  if (index === -1) return undefined
  const inline = argv[index].startsWith(`${JOB_FLAG}=`)
  const expected = inline ? 1 : 2
  if (argv.length !== expected || index !== 0) {
    throw new CliUsageError(
      `${JOB_FLAG} takes one JSON value and cannot be combined with other arguments.`,
      usage,
    )
  }
  const value = inline ? argv[0].slice(JOB_FLAG.length + 1) : argv[1]
  return value
}

export function defineCommand<TSchema extends z.ZodType, TResult>(
  definition: CommandDefinition<TSchema, TResult>,
): DefinedCommand<TSchema, TResult> {
  function resolve(argv: readonly string[]): ParsedCommand<z.output<TSchema>> {
    const value = jobValue(argv, definition.usage)
    if (value === undefined) return definition.parse(argv)
    const job = readJsonArgument(value, JOB_FLAG, definition.usage)
    return { kind: 'run', options: parseWithSchema(definition.schema, job) }
  }

  async function execute(
    argv: readonly string[],
    context: CommandContext,
  ): Promise<void> {
    const command = resolve(argv)
    if (command.kind === 'help') {
      console.log(definition.usage)
      return
    }
    const result = await definition.run(command.options, {
      onProgress: context.progress ? writeProgress : undefined,
    })
    console.log(
      context.json
        ? JSON.stringify({ command: definition.name, result }, null, 2)
        : definition.format(result),
    )
  }

  return { ...definition, resolve, execute }
}

type ArgsConfig = NonNullable<Parameters<typeof parseArgs>[0]>
export type ArgsOptions = Omit<ArgsConfig, 'args'>
type ParsedArgs<TConfig extends ArgsConfig> = ReturnType<
  typeof parseArgs<TConfig>
>

/** `node:util` `parseArgs`, turning its argument errors into a `CliUsageError` carrying `usage`. */
export function parseCliArgs<TOptions extends ArgsOptions>(
  options: TOptions,
  argv: readonly string[],
  usage: string,
): ParsedArgs<TOptions & { args: string[] }> {
  try {
    return parseArgs({ ...options, args: [...argv] })
  } catch (error) {
    if (error instanceof TypeError)
      throw new CliUsageError(error.message, usage)
    throw error
  }
}

export function toNumber(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value.trim() || Number.NaN)
}

export function toNumberList(value: string | undefined): number[] | undefined {
  if (value === undefined) return undefined
  const numbers: number[] = []
  for (const part of value.split(','))
    numbers.push(Number(part.trim() || Number.NaN))
  return numbers
}

interface ErrorReport {
  type: string
  message: string
  issues?: readonly string[]
  usage?: string
}

function reportOf(error: unknown): ErrorReport {
  if (!(error instanceof Error))
    return { type: 'Error', message: String(error) }
  if (isAppError(error)) return { type: error.kind, message: error.message }
  const report: ErrorReport = { type: error.name, message: error.message }
  if (error instanceof ImageOptionsError) report.issues = error.issues
  if (error instanceof CliUsageError) report.usage = error.usage
  return report
}

/**
 * Runs a CLI entry point, printing errors without stack traces and setting
 * the exit code. With `json`, the error is one JSON document on stderr.
 */
export async function runCli(
  main: () => Promise<void>,
  context: Pick<CommandContext, 'json'>,
): Promise<void> {
  try {
    await main()
  } catch (error) {
    process.exitCode = isAppError(error)
      ? ERROR_REPORTING[error.kind].exitCode
      : 1
    if (context.json) {
      console.error(JSON.stringify({ error: reportOf(error) }))
      return
    }
    if (error instanceof CliUsageError) {
      console.error(`${error.message}\n\n${error.usage}`)
      return
    }
    console.error(error instanceof Error ? error.message : String(error))
  }
}
