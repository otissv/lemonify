import { z } from 'zod'

import { parseWithSchema } from '../../src/lib/images/validation.ts'
import type { App } from '../../src/server/composition.ts'
import type { Actor } from '../../src/server/domain/actor.ts'
import { USER_FLAG, withActor } from './app-session.ts'
import {
  CliUsageError,
  PROGRAM,
  defineCommand,
  parseCliArgs,
  readJsonArgument,
} from './cli.ts'
import type { ArgsOptions, ParsedCommand, RunContext } from './cli.ts'

export type FlagSpec = {
  type: 'string' | 'boolean'
  /** The option this flag fills; the camel-case form of the flag name when omitted. */
  key?: string
  /** The value is JSON: inline, `@file.json`, or `-` for stdin. */
  json?: boolean
}

export type AppCommandContext<TOptions> = {
  app: App
  actor: Actor
  options: TOptions
  onProgress?: RunContext['onProgress']
}

export type AppCommandSpec<TShape extends z.ZodRawShape, TResult> = {
  name: string
  summary: string
  /** The lines after the usage line: what the command does and its options. */
  help: string
  /** The command's arguments as the usage line shows them, e.g. `<sourceId>`. */
  synopsis: string
  shape: TShape
  /** The options that positional arguments fill, in order. */
  positionals?: ReadonlyArray<string>
  flags?: Readonly<Record<string, FlagSpec>>
  run(
    context: AppCommandContext<
      z.output<z.ZodObject<TShape & { user: z.ZodOptional<z.ZodString> }>>
    >,
  ): Promise<TResult>
  format?(result: TResult): string
}

const USER_ONLY = z.looseObject({ user: z.string().optional() })

const HELP_OPTION = { help: { type: 'boolean', short: 'h' } } as const

function camelCase(flag: string): string {
  return flag.replace(/-([a-z])/g, (_match, letter: string) =>
    letter.toUpperCase(),
  )
}

function usageText(name: string, synopsis: string, help: string): string {
  return `Usage: ${PROGRAM} ${name}${synopsis === '' ? '' : ` ${synopsis}`} [${USER_FLAG} <name>]

${help}

Every command that works on a user's images also takes:
  ${USER_FLAG} <name>        Act as this user (default: LEMONIFY_USER, or the only user)
  -h, --help           Show this help`
}

function argsFor(flags: Readonly<Record<string, FlagSpec>>): ArgsOptions {
  const options: Record<
    string,
    { type: 'string' | 'boolean'; short?: string }
  > = { ...HELP_OPTION, user: { type: 'string' } }
  for (const [name, flag] of Object.entries(flags)) {
    options[name] = { type: flag.type }
  }
  return { allowPositionals: true, strict: true, options }
}

/**
 * A command that acts as a User on the app's services. It builds the same
 * composed app the web server uses, resolves the acting User from `--user`,
 * and prints the result as JSON (with `--json`) or as the lines `format`
 * makes. Flags, positionals and `--job` JSON all feed one Zod schema.
 */
export function defineAppCommand<TShape extends z.ZodRawShape, TResult>(
  spec: AppCommandSpec<TShape, TResult>,
) {
  const usage = usageText(spec.name, spec.synopsis, spec.help)
  const flags = spec.flags ?? {}
  const schema = z.strictObject({
    ...spec.shape,
    user: z.string().optional(),
  })
  const args = argsFor(flags)
  const positionals = spec.positionals ?? []

  function parse(
    argv: readonly string[],
  ): ParsedCommand<z.output<typeof schema>> {
    const parsed = parseCliArgs(args, argv, usage)
    const values: Record<string, unknown> = { ...parsed.values }
    if (values.help) return { kind: 'help' }
    if (parsed.positionals.length > positionals.length) {
      throw new CliUsageError(
        `Too many arguments: expected ${spec.synopsis || 'none'}.`,
        usage,
      )
    }
    const input: Record<string, unknown> = { user: values.user }
    for (const [index, value] of parsed.positionals.entries()) {
      const key = positionals[index]
      if (key !== undefined) input[key] = value
    }
    for (const [name, flag] of Object.entries(flags)) {
      const value = values[name]
      if (value === undefined) continue
      const key = flag.key ?? camelCase(name)
      input[key] =
        flag.json && typeof value === 'string'
          ? readJsonArgument(value, `--${name}`, usage)
          : value
    }
    return { kind: 'run', options: parseWithSchema(schema, input) }
  }

  return defineCommand({
    name: spec.name,
    summary: spec.summary,
    usage,
    schema,
    parse,
    run: (options, context) =>
      withActor(USER_ONLY.parse(options).user, (app, actor) =>
        spec.run({ app, actor, options, onProgress: context.onProgress }),
      ),
    format: spec.format ?? ((result) => JSON.stringify(result, null, 2)),
  })
}
