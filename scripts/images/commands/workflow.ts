import { z } from 'zod'

import { canvasSchema } from '../../../src/features/pipeline/canvas.ts'
import { PipelineSchema } from '../../../src/features/pipeline/pipeline.ts'
import {
  OutputSettingsSchema,
  defaultOutputSettings,
} from '../../../src/features/workflows/output-settings.ts'
import {
  DEFAULT_WORKFLOW_CANVAS,
  RunCanvasMode,
  RunCanvasModeSchema,
} from '../../../src/features/workflows/workflow.ts'
import type { WorkflowDefinition } from '../../../src/features/workflows/workflow.ts'
import {
  WorkflowStepSpecsSchema,
  workflowDefinitionFromSteps,
} from '../../../src/features/workflows/workflow-from-steps.ts'
import { RunState } from '../../../src/server/dao/workflow-dao.ts'
import { ValidationError } from '../../../src/server/errors.ts'
import type { Actor } from '../../../src/server/domain/actor.ts'
import type { WorkflowView } from '../../../src/server/services/workflow-service.ts'
import type { App } from '../../../src/server/composition.ts'
import { defineAppCommand } from '../app-command.ts'
import { withWorkers } from '../in-process-workers.ts'
import { EXISTING_FILES, writeRunOutputs } from '../write-outputs.ts'
import type { ExistingFiles } from '../write-outputs.ts'

const id = z.string().min(1)
const dimension = z.coerce.number().int().positive()
const WAIT_MS = 500

const JSON_FLAG = 'JSON: inline, @file.json, or - for stdin'
const SOURCES_HELP =
  '--sources <ids>      Comma-separated source ids the workflow runs on'
const OUTPUT_HELP =
  '--output <json>      Output settings: format, options, keepMetadata, widths, suffix'
const CANVAS_HELP = `  --width <px>         Canvas width in pixels
  --height <px>        Canvas height in pixels
  --background <c>     A colour like #ff8000, or transparent`

function sourceIds(raw: string | undefined): string[] {
  if (raw === undefined) return []
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '')
}

const BUILD_SHAPE = {
  sources: z.string().optional(),
  steps: WorkflowStepSpecsSchema.optional(),
  output: OutputSettingsSchema.optional(),
  pipeline: PipelineSchema.optional(),
  width: dimension.optional(),
  height: dimension.optional(),
  background: z.string().optional(),
}

const BUILD_FLAGS = {
  sources: { type: 'string' },
  steps: { type: 'string', json: true },
  output: { type: 'string', json: true },
  pipeline: { type: 'string', json: true },
  width: { type: 'string' },
  height: { type: 'string' },
  background: { type: 'string' },
} as const

type BuildOptions = {
  sources?: string
  steps?: z.output<typeof WorkflowStepSpecsSchema>
  output?: z.output<typeof OutputSettingsSchema>
  pipeline?: z.output<typeof PipelineSchema>
  width?: number
  height?: number
  background?: string
}

function hasCanvasFlags(options: BuildOptions): boolean {
  return (
    options.width !== undefined ||
    options.height !== undefined ||
    options.background !== undefined
  )
}

function chosenCanvas(
  options: BuildOptions,
  current: WorkflowView | undefined,
) {
  const base = current?.pipeline.canvas ?? DEFAULT_WORKFLOW_CANVAS
  return canvasSchema.parse({
    width: options.width ?? base.width,
    height: options.height ?? base.height,
    background: options.background ?? base.background,
  })
}

function withNewInputs(
  current: ReadonlyArray<string>,
  raw: string | undefined,
): string[] {
  return [...new Set([...current, ...sourceIds(raw)])]
}

/**
 * The definition the flags describe. --pipeline is the whole pipeline (canvas
 * and steps). Otherwise --steps rebuilds the steps (after one empty image
 * layer for the input image), and without it a current workflow keeps its
 * pipeline. The canvas flags change the canvas, --sources adds input images and
 * --output replaces the Output settings.
 */
function chooseDefinition(
  options: BuildOptions,
  current: WorkflowView | undefined,
): WorkflowDefinition {
  const { pipeline, steps, sources, output } = options
  if (pipeline !== undefined) {
    if (steps !== undefined || hasCanvasFlags(options)) {
      throw new ValidationError(
        'Give --pipeline on its own, or --steps with the canvas flags.',
      )
    }
    return {
      pipeline,
      inputs: withNewInputs(current?.inputs ?? [], sources),
      output: output ?? current?.output ?? defaultOutputSettings(),
    }
  }
  const canvas = chosenCanvas(options, current)
  const inputs = withNewInputs(current?.inputs ?? [], sources)
  if (current !== undefined && steps === undefined) {
    return {
      pipeline: { ...current.pipeline, canvas },
      inputs,
      output: output ?? current.output,
    }
  }
  return workflowDefinitionFromSteps({
    inputs,
    steps: steps ?? [],
    canvas,
    output: output ?? current?.output,
  })
}

export const workflowCreateCommand = defineAppCommand({
  name: 'workflow create',
  summary: 'Create a workflow',
  synopsis:
    '<name> [--width <px> --height <px> --background <c>] [--sources <ids>] [--steps <json>] [--output <json>] [--pipeline <json>]',
  help: `Creates a workflow: a pipeline, like a document's, that runs on each source.
The pipeline has an empty image layer, which is where each source is drawn, and
then --steps in order: {"op":"resize","options":{"width":800}} for a Sharp
operation, {"tool":"upscale","settings":{...}} for an AI tool. The canvas is
1920x1080 unless you size it. With --pipeline you give the whole pipeline
({canvas, steps}) yourself, with image layers and groups as in a document.

Options:
${CANVAS_HELP}
  ${SOURCES_HELP}
  --steps <json>       The steps after the input layer (${JSON_FLAG})
  ${OUTPUT_HELP}
  --pipeline <json>    The whole pipeline (${JSON_FLAG}); not with --steps or the canvas flags`,
  shape: { name: z.string().min(1), ...BUILD_SHAPE },
  positionals: ['name'],
  flags: BUILD_FLAGS,
  async run({ app, actor, options }) {
    const definition = chooseDefinition(options, undefined)
    return {
      workflow: await app.workflows.create(actor, options.name, definition),
    }
  },
})

export const workflowShowCommand = defineAppCommand({
  name: 'workflow show',
  summary: 'Print a workflow',
  synopsis: '<id>',
  help: 'Prints the workflow: its canvas and steps, its source images and its Output settings.',
  shape: { id },
  positionals: ['id'],
  async run({ app, actor, options }) {
    return { workflow: await app.workflows.get(actor, options.id) }
  },
})

export const workflowListCommand = defineAppCommand({
  name: 'workflow list',
  summary: 'List your workflows',
  synopsis: '',
  help: 'Lists your workflows.',
  shape: {},
  async run({ app, actor }) {
    return { workflows: await app.workflows.list(actor) }
  },
})

export const workflowUpdateCommand = defineAppCommand({
  name: 'workflow update',
  summary: 'Change a workflow',
  synopsis:
    '<id> [--name <name>] [--width <px> --height <px> --background <c>] [--sources <ids>] [--steps <json>] [--output <json>] [--pipeline <json>]',
  help: `Changes a workflow as it is now. The canvas flags change the canvas and what you
leave out stays. --sources adds source images and --output replaces the Output
settings. --steps replaces the steps after one empty image layer. --pipeline
replaces the whole pipeline.

Options:
  --name <name>        Rename the workflow
${CANVAS_HELP}
  ${SOURCES_HELP}
  --steps <json>       The steps after the input layer (${JSON_FLAG})
  ${OUTPUT_HELP}
  --pipeline <json>    The whole pipeline (${JSON_FLAG}); not with --steps or the canvas flags`,
  shape: { id, name: z.string().min(1).optional(), ...BUILD_SHAPE },
  positionals: ['id'],
  flags: { name: { type: 'string' }, ...BUILD_FLAGS },
  async run({ app, actor, options }) {
    const current = await app.workflows.get(actor, options.id)
    const name = options.name ?? current.name
    return {
      workflow: await app.workflows.update(
        actor,
        options.id,
        current.revision,
        { name, definition: chooseDefinition(options, current) },
      ),
    }
  },
})

export const workflowDeleteCommand = defineAppCommand({
  name: 'workflow delete',
  summary: 'Delete a workflow',
  synopsis: '<id>',
  help: 'Deletes a workflow. Its earlier runs and their results are kept until you delete them.',
  shape: { id },
  positionals: ['id'],
  async run({ app, actor, options }) {
    await app.workflows.delete(actor, options.id)
    return { deleted: options.id }
  },
})

const OUTPUT_SHAPE = {
  out: z.string().min(1).optional(),
  existing: z
    .enum(EXISTING_FILES as [ExistingFiles, ...ExistingFiles[]])
    .default('number'),
  manifest: z.boolean().default(false),
}

const OUTPUT_FLAGS = {
  out: { type: 'string' },
  existing: { type: 'string' },
  manifest: { type: 'boolean' },
} as const

const OUTPUT_FLAG_HELP = `  --out <folder>       Write the finished images into this folder
  --existing <policy>  When a file exists: ${EXISTING_FILES.join(', ')} (default: number)
  --manifest           Also write manifest.json beside the images`

async function waitForRun(app: App, actor: Actor, runId: string) {
  for (;;) {
    const run = await app.workflows.getRun(actor, runId)
    if (run.state !== RunState.Running) return run
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS))
  }
}

async function written(
  app: App,
  actor: Actor,
  runId: string,
  options: { out?: string; existing: ExistingFiles; manifest: boolean },
) {
  if (options.out === undefined) return undefined
  const outputs = await app.workflows.runOutputs(actor, runId)
  return writeRunOutputs(app, actor, outputs, options.out, {
    existing: options.existing,
    manifest: options.manifest,
  })
}

export const workflowRunCommand = defineAppCommand({
  name: 'workflow run',
  summary: 'Run a workflow on its sources',
  synopsis:
    '<id> [--canvas workflow|first-image] [--follow] [--out <folder>] [--existing <policy>] [--manifest]',
  help: `Starts a run: one job per source, each source drawn in the workflow's input
layer. By default every image is drawn on the workflow's canvas; --canvas
first-image gives each image a canvas of its own size and the workflow's
background. Without --follow the run is queued and this
returns at once; the server or a \`worker\` process does the work. With --follow
this process does the work, waits for the run to end and, with --out, writes the
images.

Options:
  --canvas <mode>      workflow (default) or first-image
  --follow             Do the work here and wait for the run to end
${OUTPUT_FLAG_HELP}`,
  shape: {
    id,
    canvas: RunCanvasModeSchema.default(RunCanvasMode.Workflow),
    follow: z.boolean().default(false),
    ...OUTPUT_SHAPE,
  },
  positionals: ['id'],
  flags: {
    canvas: { type: 'string' },
    follow: { type: 'boolean' },
    ...OUTPUT_FLAGS,
  },
  async run({ app, actor, options }) {
    if (options.out !== undefined && !options.follow) {
      throw new ValidationError(
        '--out needs --follow, so the images exist when they are written.',
      )
    }
    const started = await app.workflows.run(actor, options.id, {
      canvas: options.canvas,
    })
    if (!options.follow) return { run: started }
    return withWorkers(app, async () => {
      const run = await waitForRun(app, actor, started.id)
      return { run, files: await written(app, actor, run.id, options) }
    })
  },
})

export const workflowResultsCommand = defineAppCommand({
  name: 'workflow results',
  summary: 'Write what a run made to a folder',
  synopsis: '<runId> --out <folder> [--existing <policy>] [--manifest]',
  help: `Writes the finished images of a run into a folder, named as the workflow's
Output settings named them. Items still running are left out.

Options:
${OUTPUT_FLAG_HELP}`,
  shape: { runId: id, ...OUTPUT_SHAPE },
  positionals: ['runId'],
  flags: OUTPUT_FLAGS,
  async run({ app, actor, options }) {
    if (options.out === undefined)
      throw new ValidationError('Give --out <folder>.')
    return {
      files: await written(app, actor, options.runId, options),
    }
  },
})

export const workflowRunsCommand = defineAppCommand({
  name: 'workflow runs',
  summary: 'List workflow runs',
  synopsis: '[--workflow <id>]',
  help: `Lists runs, newest first, with their state and progress.

Options:
  --workflow <id>      Only this workflow's runs`,
  shape: { workflow: id.optional() },
  flags: { workflow: { type: 'string' } },
  async run({ app, actor, options }) {
    return { runs: await app.workflows.listRuns(actor, options.workflow) }
  },
})

export const workflowRunShowCommand = defineAppCommand({
  name: 'workflow run show',
  summary: 'Print one workflow run with its items',
  synopsis: '<runId>',
  help: 'Prints the run: its state and progress, and each item with its state and result.',
  shape: { runId: id },
  positionals: ['runId'],
  async run({ app, actor, options }) {
    return { run: await app.workflows.getRun(actor, options.runId) }
  },
})

export const workflowCancelCommand = defineAppCommand({
  name: 'workflow cancel',
  summary: 'Cancel a run',
  synopsis: '<runId>',
  help: "Drops the run's waiting jobs and asks running ones to stop.",
  shape: { runId: id },
  positionals: ['runId'],
  async run({ app, actor, options }) {
    return { run: await app.workflows.cancelRun(actor, options.runId) }
  },
})

export const workflowRunDeleteCommand = defineAppCommand({
  name: 'workflow run delete',
  summary: 'Delete a finished run and its results',
  synopsis: '<runId>',
  help: 'Deletes a run that is not running, and the images it made.',
  shape: { runId: id },
  positionals: ['runId'],
  async run({ app, actor, options }) {
    await app.workflows.deleteRun(actor, options.runId)
    return { deleted: options.runId }
  },
})
