import {
  CliUsageError,
  JOB_FLAG,
  JSON_FLAG,
  PROGRAM,
  PROGRESS_FLAG,
} from './cli.ts'
import type { ImageCommand } from './cli.ts'

const HELP_FLAGS: readonly string[] = ['--help', '-h']
const NAME_COLUMN = 26

export type Dispatch =
  | { kind: 'help'; json: boolean; progress: boolean }
  | {
      kind: 'run'
      command: ImageCommand
      argv: string[]
      json: boolean
      progress: boolean
    }

const GLOBAL_FLAGS: readonly string[] = [JSON_FLAG, PROGRESS_FLAG]

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
  ${PROGRESS_FLAG}           Write progress to stderr as JSON lines, e.g.
                       {"event":"progress","fraction":0.5} (upscale only)

Run \`${PROGRAM} <command> --help\` for a command's options.`
}

function unknownCommand(
  commands: readonly ImageCommand[],
  args: readonly string[],
): CliUsageError {
  for (let length = args.length; length >= 1; length -= 1) {
    const prefix = args.slice(0, length).join(' ')
    const family = commands.filter((candidate) =>
      candidate.name.startsWith(`${prefix} `),
    )
    if (family.length === 0) continue
    const names = family.map((candidate) => candidate.name).join(', ')
    return new CliUsageError(
      `"${prefix}" needs a subcommand: ${names}.`,
      mainUsage(commands),
    )
  }
  return new CliUsageError(
    `Unknown command "${args[0] ?? ''}".`,
    mainUsage(commands),
  )
}

function matchesLeading(
  command: ImageCommand,
  args: readonly string[],
): number {
  const words = command.name.split(' ')
  if (words.length > args.length) return 0
  return words.every((word, index) => args[index] === word) ? words.length : 0
}

/**
 * Picks the command whose name (one word, or several like `document step add`)
 * the arguments start with, preferring the longest name; everything after it
 * belongs to that command. `--json` and `--progress` may appear anywhere and
 * are removed.
 */
export function dispatch(
  commands: readonly ImageCommand[],
  argv: readonly string[],
): Dispatch {
  const json = argv.includes(JSON_FLAG)
  const progress = argv.includes(PROGRESS_FLAG)
  const args: string[] = []
  for (const arg of argv) if (!GLOBAL_FLAGS.includes(arg)) args.push(arg)
  if (args.length === 0) return { kind: 'help', json, progress }
  if (HELP_FLAGS.includes(args[0])) return { kind: 'help', json, progress }
  let selected: { command: ImageCommand; words: number } | undefined
  for (const command of commands) {
    const words = matchesLeading(command, args)
    if (words > (selected?.words ?? 0)) selected = { command, words }
  }
  if (selected === undefined) throw unknownCommand(commands, args)
  return {
    kind: 'run',
    command: selected.command,
    argv: args.slice(selected.words),
    json,
    progress,
  }
}
