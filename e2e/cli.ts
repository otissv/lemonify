import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import { z } from 'zod'

const run = promisify(execFile)

const ROOT = path.resolve(import.meta.dirname, '..')
const CLI_TIMEOUT = 120_000

const PackageSchema = z.object({ scripts: z.object({ images: z.string() }) })

/** `pnpm images` as package.json runs it, without pnpm: node and its flags, then the entry file. */
function imagesCommand(): { command: string; args: string[] } {
  const pkg = PackageSchema.parse(
    JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')),
  )
  const [command, ...args] = pkg.scripts.images.split(' ')
  if (command === undefined) throw new Error('The images script is empty.')
  return { command: command === 'node' ? process.execPath : command, args }
}

const IMAGES = imagesCommand()

export type CliOutcome = {
  /** The process's exit code: 0 when the command did what it was asked. */
  code: number
  /** The JSON the command printed with --json. */
  json: unknown
  stderr: string
}

const ExecErrorSchema = z.object({
  code: z.number(),
  stdout: z.string(),
  stderr: z.string(),
})

function parsed(stdout: string): unknown {
  const text = stdout.trim()
  return text === '' ? null : JSON.parse(text)
}

/**
 * Runs the images command line as its own process, the way a person or a
 * script runs it, on the data folder given, and reads what it printed with
 * --json. A failing command resolves too, with its exit code.
 */
export async function images(
  dataDir: string,
  args: ReadonlyArray<string>,
): Promise<CliOutcome> {
  try {
    const { stdout, stderr } = await run(
      IMAGES.command,
      [...IMAGES.args, ...args, '--json'],
      {
        cwd: ROOT,
        env: { ...process.env, LEMONIFY_DATA_DIR: dataDir },
        timeout: CLI_TIMEOUT,
        maxBuffer: 64 * 1024 * 1024,
      },
    )
    return { code: 0, json: parsed(stdout), stderr }
  } catch (caught) {
    const failed = ExecErrorSchema.safeParse(caught)
    if (!failed.success) throw caught
    return {
      code: failed.data.code,
      json: parsed(failed.data.stdout),
      stderr: failed.data.stderr,
    }
  }
}

const SuccessSchema = z.object({ command: z.string(), result: z.unknown() })
const FailureSchema = z.object({
  error: z.object({ type: z.string(), message: z.string() }),
})

/** The result of a command that must succeed, checked against its schema. */
export async function cliResult<T>(
  dataDir: string,
  args: ReadonlyArray<string>,
  schema: z.ZodType<T>,
): Promise<T> {
  const outcome = await images(dataDir, args)
  if (outcome.code !== 0) {
    throw new Error(
      `images ${args.join(' ')} failed (${outcome.code}): ${JSON.stringify(outcome.json)} ${outcome.stderr}`,
    )
  }
  return schema.parse(SuccessSchema.parse(outcome.json).result)
}

/** The error a failing command printed: the last line of its error output that is JSON with an `error`. */
function reportedError(stderr: string): unknown {
  const lines = stderr.trim().split('\n').reverse()
  const line = lines.find((candidate) => candidate.startsWith('{"error"'))
  if (line === undefined) throw new Error(`No error was reported: ${stderr}`)
  return JSON.parse(line)
}

/** The message of a command that must fail, with its exit code. */
export async function cliFailure(
  dataDir: string,
  args: ReadonlyArray<string>,
): Promise<{ code: number; type: string; message: string }> {
  const outcome = await images(dataDir, args)
  if (outcome.code === 0) {
    throw new Error(
      `images ${args.join(' ')} succeeded, but should have failed.`,
    )
  }
  const { error } = FailureSchema.parse(reportedError(outcome.stderr))
  return { code: outcome.code, ...error }
}

const StepSchema = z.object({
  id: z.string(),
  kind: z.string(),
  op: z.string().optional(),
  enabled: z.boolean().optional(),
})

export const WorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  pipeline: z.object({
    canvas: z.object({
      width: z.number(),
      height: z.number(),
      background: z.string(),
    }),
    steps: z.array(StepSchema),
  }),
  canvasSize: z.enum(['match-input', 'fixed']),
  inputs: z.array(z.string()),
  output: z.object({ format: z.string(), suffix: z.string() }),
  canUndo: z.boolean(),
  canRedo: z.boolean(),
})

export const RunSchema = z.object({
  id: z.string(),
  workflowId: z.string().nullable(),
  sourceIds: z.array(z.string()),
  state: z.enum(['running', 'done', 'failed', 'cancelled']),
  errors: z.array(z.string()),
  items: z.array(
    z.object({
      sourceId: z.string(),
      state: z.enum(['waiting', 'running', 'done', 'failed', 'cancelled']),
      resultIds: z.array(z.string()),
    }),
  ),
})

export const WorkflowResult = z.object({ workflow: WorkflowSchema })
export const WorkflowsResult = z.object({ workflows: z.array(WorkflowSchema) })
export const RunResult = z.object({ run: RunSchema })
export const RunsResult = z.object({ runs: z.array(RunSchema) })
export const SourceResult = z.object({
  source: z.object({ id: z.string(), fileName: z.string() }),
})
export const SourcesResult = z.object({
  sources: z.array(z.object({ id: z.string(), fileName: z.string() })),
})
