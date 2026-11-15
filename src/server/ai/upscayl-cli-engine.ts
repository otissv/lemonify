import { spawn } from 'node:child_process'
import { copyFile, link, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'

import sharp from 'sharp'
import { z } from 'zod'

import { AiToolId } from '@/features/ai/ai-tools'
import type { AiCatalogue, AiModelSummary } from '@/features/ai/ai-tools'
import {
  DEFAULT_UPSCALE_MODEL,
  modelManifest,
} from '@/lib/images/upscale-models'

import { AiCancelledError, AiEngineError } from './ai-engine.ts'
import type {
  AiBatch,
  AiEngine,
  AiProgressListener,
  RunningAi,
} from './ai-engine.ts'

export interface CliCommand {
  executable: string
  args: ReadonlyArray<string>
}

/** Turns a JSON job for the image CLI's `upscale` command into the process to start. */
export type CliCommandBuilder = (job: Record<string, unknown>) => CliCommand

const CLI_ENTRY = path.join('scripts', 'images', 'index.ts')
const REGISTER_ALIAS = path.join('scripts', 'images', 'register-alias.ts')
const NODE_FLAGS = [
  '--disable-warning=ExperimentalWarning',
  '--experimental-transform-types',
]
const WORKING_COPY_OPS = [{ op: 'png' }]
const FALLBACK_FAILURE = 'The AI step stopped unexpectedly.'
const STDERR_LINES_KEPT = 20
const ID_PATTERN = /^[\w-]+$/

/** Starts the image CLI with the project's loader flags, from the project folder. */
export const nodeCliCommand: CliCommandBuilder = (job) => ({
  executable: process.execPath,
  args: [
    ...NODE_FLAGS,
    '--import',
    path.join(process.cwd(), REGISTER_ALIAS),
    path.join(process.cwd(), CLI_ENTRY),
    'upscale',
    '--job',
    JSON.stringify(job),
    '--json',
    '--progress',
  ],
})

const ProgressLineSchema = z.object({
  event: z.literal('progress'),
  fraction: z.number().min(0).max(1),
})

const RunResultSchema = z.object({
  result: z.object({
    images: z.array(
      z.object({
        output: z.string().min(1),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }),
    ),
  }),
})

const FailureLineSchema = z.object({
  error: z.object({ message: z.string().min(1) }),
})

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

function failureMessage(lines: ReadonlyArray<string>): string {
  for (const line of [...lines].reverse()) {
    const failure = FailureLineSchema.safeParse(parseJsonLine(line))
    if (failure.success) return failure.data.error.message
  }
  return FALLBACK_FAILURE
}

function stopProcessGroup(pid: number | undefined): void {
  if (pid === undefined) return
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, 'SIGTERM')
  } catch {
    /* Already gone. */
  }
}

interface RunningProcess {
  output: Promise<string>
  cancel(): void
}

/**
 * Runs the command in its own process group, so a GPU crash cannot take the
 * server down and cancelling stops `upscayl-bin` along with the CLI. Resolves
 * with what the CLI printed once it exits successfully.
 */
function runProcess(
  command: CliCommand,
  onProgress: AiProgressListener,
): RunningProcess {
  const child = spawn(command.executable, [...command.args], {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let cancelled = false
  let stdout = ''
  const stderrLines: Array<string> = []
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
  })
  createInterface({ input: child.stderr }).on('line', (line) => {
    const progress = ProgressLineSchema.safeParse(parseJsonLine(line))
    if (progress.success) {
      onProgress(progress.data.fraction)
      return
    }
    stderrLines.push(line)
    if (stderrLines.length > STDERR_LINES_KEPT) stderrLines.shift()
  })
  const output = new Promise<string>((resolve, reject) => {
    child.on('error', (error) => {
      reject(new AiEngineError(FALLBACK_FAILURE, { cause: error }))
    })
    child.on('close', (code) => {
      if (cancelled) reject(new AiCancelledError())
      else if (code !== 0) {
        reject(
          new AiEngineError(failureMessage(stderrLines), {
            cause: new Error(stderrLines.join('\n')),
          }),
        )
      } else resolve(stdout)
    })
  })
  return {
    output,
    cancel() {
      if (cancelled || child.exitCode !== null) return
      cancelled = true
      stopProcessGroup(child.pid)
    },
  }
}

function isCrossDevice(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EXDEV'
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch (error) {
    if (!isCrossDevice(error)) throw error
    await copyFile(from, to)
    await rm(from, { force: true })
  }
}

/** The CLI skips symbolic links, so inputs are hard-linked (free) or, across disks, copied. */
async function linkOrCopy(from: string, to: string): Promise<void> {
  try {
    await link(from, to)
  } catch (error) {
    if (!isCrossDevice(error)) throw error
    await copyFile(from, to)
  }
}

async function stageInputs(batch: AiBatch, inputs: string): Promise<void> {
  for (const request of batch.requests) {
    if (!ID_PATTERN.test(request.id)) {
      throw new AiEngineError('The AI step was given an image it cannot name.')
    }
    const { format } = await sharp(request.input).metadata()
    await linkOrCopy(
      request.input,
      path.join(inputs, `${request.id}.${format}`),
    )
  }
}

function modelSummaries(): AiModelSummary[] {
  const models: AiModelSummary[] = []
  for (const { name, category, description, scales, noise } of modelManifest()
    .models) {
    models.push({ name, category, description, scales, noise })
  }
  return models
}

export interface UpscaylCliEngineOptions {
  /** A folder, on the same disk as the outputs, where batches are staged. */
  workRoot: string
  command?: CliCommandBuilder
}

/**
 * Upscale through the image CLI: a batch is staged as a folder, run as one
 * CLI process (so the model loads once), and each finished PNG is moved to
 * where its request asked. The CLI is a separate process so a GPU crash or a
 * cancel never touches the server.
 */
export class UpscaylCliEngine implements AiEngine {
  readonly #workRoot: string
  readonly #command: CliCommandBuilder

  constructor({ workRoot, command = nodeCliCommand }: UpscaylCliEngineOptions) {
    this.#workRoot = workRoot
    this.#command = command
  }

  run(batch: AiBatch, onProgress: AiProgressListener): RunningAi {
    let cancelled = false
    let running: RunningProcess | undefined
    const result = this.#execute(
      batch,
      onProgress,
      (process) => {
        running = process
        if (cancelled) process.cancel()
      },
      () => cancelled,
    )
    return {
      result,
      cancel() {
        cancelled = true
        running?.cancel()
      },
    }
  }

  async catalogue(tool: AiToolId): Promise<AiCatalogue> {
    if (tool !== AiToolId.Upscale) {
      throw new AiEngineError(`This engine has no models for "${tool}".`)
    }
    return { defaultModel: DEFAULT_UPSCALE_MODEL, models: modelSummaries() }
  }

  async #execute(
    batch: AiBatch,
    onProgress: AiProgressListener,
    started: (process: RunningProcess) => void,
    isCancelled: () => boolean,
  ) {
    if (batch.tool !== AiToolId.Upscale) {
      throw new AiEngineError(`This engine cannot run "${batch.tool}".`)
    }
    await mkdir(this.#workRoot, { recursive: true })
    const work = await mkdtemp(path.join(this.#workRoot, 'batch-'))
    try {
      const inputs = path.join(work, 'in')
      const outputs = path.join(work, 'out')
      await mkdir(inputs)
      await stageInputs(batch, inputs)
      if (isCancelled()) throw new AiCancelledError()
      const { model, scale, noise, iterations, tta } = batch.settings
      const process = runProcess(
        this.#command({
          source: inputs,
          destination: outputs,
          model,
          scale,
          noise,
          iterations,
          tta,
          ops: WORKING_COPY_OPS,
        }),
        onProgress,
      )
      started(process)
      const printed = RunResultSchema.safeParse(
        parseJsonLine(await process.output),
      )
      if (!printed.success) {
        throw new AiEngineError(FALLBACK_FAILURE, { cause: printed.error })
      }
      return await this.#collect(batch, printed.data.result.images)
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  }

  async #collect(
    batch: AiBatch,
    images: ReadonlyArray<{ output: string; width: number; height: number }>,
  ) {
    const byId = new Map(
      images.map((image) => [path.parse(image.output).name, image]),
    )
    const results: Array<{ id: string; width: number; height: number }> = []
    for (const request of batch.requests) {
      const image = byId.get(request.id)
      if (image === undefined) {
        throw new AiEngineError('The AI step did not make every image.')
      }
      await moveFile(image.output, request.output)
      results.push({ id: request.id, width: image.width, height: image.height })
    }
    return results
  }
}
