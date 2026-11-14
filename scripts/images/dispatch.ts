import { CliUsageError, JOB_FLAG, JSON_FLAG, PROGRAM } from './cli.ts'
import type { ImageCommand } from './cli.ts'

const HELP_FLAGS: readonly string[] = ['--help', '-h']
const NAME_COLUMN = 12

export type Dispatch =
  | { kind: 'help'; json: boolean }
  | { kind: 'run'; command: ImageCommand; argv: string[]; json: boolean }

export function mainUsage(commands: readonly ImageCommand[]): string {
  const lines: string[] = []
  for (const command of commands) {
    lines.push(`  ${command.name.padEnd(NAME_COLUMN)}${command.summary}`)
  }
  return `Usage: ${PROGRAM} <command> [options]

Commands:
${lines.join('\n')}

Every command also accepts:
  ${JOB_FLAG} <json>         Options as one JSON object instead of flags: inline,
                       @file.json, or - for stdin. \`${PROGRAM} schema <command>\`
                       prints its JSON Schema.
  ${JSON_FLAG}               Print the result (or error) as one JSON document

Run \`${PROGRAM} <command> --help\` for a command's options.`
}

/**
 * Picks the subcommand named by the first argument; everything after it
 * belongs to that command. `--json` may appear anywhere and is removed.
 */
export function dispatch(
  commands: readonly ImageCommand[],
  argv: readonly string[],
): Dispatch {
  const json = argv.includes(JSON_FLAG)
  const args: string[] = []
  for (const arg of argv) if (arg !== JSON_FLAG) args.push(arg)
  if (args.length === 0) return { kind: 'help', json }
  const [name, ...rest] = args
  if (HELP_FLAGS.includes(name)) return { kind: 'help', json }
  const command = commands.find((candidate) => candidate.name === name)
  if (!command) {
    throw new CliUsageError(`Unknown command "${name}".`, mainUsage(commands))
  }
  return { kind: 'run', command, argv: rest, json }
}
