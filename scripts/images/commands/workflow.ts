import path from 'node:path'

import { z } from 'zod'

import { canvasSchema } from '../../../src/features/pipeline/canvas.ts'
import { PipelineSchema } from '../../../src/features/pipeline/pipeline.ts'
import {
  OutputSettingsSchema,
  defaultOutputSettings,
} from '../../../src/features/workflows/output-settings.ts'
import {
  CanvasSize,
  CanvasSizeSchema,
  DEFAULT_WORKFLOW_CANVAS,
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
import { writeWorkflowPreview } from '../preview-workflow.ts'
import { parseRegion } from '../region.ts'
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
const CANVAS_HELP = `  --canvas-size <s>    match-input (the canvas takes each input image's size)
                       or fixed (the width and height below, for every image)
  --width <px>         Canvas width in pixels, for a fixed canvas
  --height <px>        Canvas height in pixels, for a fixed canvas
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
  canvasSize: CanvasSizeSchema.optional(),
  width: dimension.optional(),
  height: dimension.optional(),
  background: z.string().optional(),
  without: z.string().optional(),
}

const BUILD_FLAGS = {
  sources: { type: 'string' },
  steps: { type: 'string', json: true },
  output: { type: 'string', json: true },
  pipeline: { type: 'string', json: true },
  'canvas-size': { type: 'string' },
  width: { type: 'string' },
  height: { type: 'string' },
  background: { type: 'string' },
  without: { type: 'string' },
} as const

type BuildOptions = {
  sources?: string
  steps?: z.output<typeof WorkflowStepSpecsSchema>
  output?: z.output<typeof OutputSettingsSchema>
  pipeline?: z.output<typeof PipelineSchema>
  canvasSize?: CanvasSize
  width?: number
  height?: number
  background?: string
  without?: string
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

/**
 * Whether the canvas takes each input image's size: --canvas-size when given;
 * otherwise a width or height asks for a fixed canvas of that size, and
 * without either a workflow keeps what it had and a new one matches its images.
 */
function chosenCanvasSize(
  options: BuildOptions,
  current: WorkflowView | undefined,
): CanvasSize {
  if (options.canvasSize !== undefined) return options.canvasSize
  if (options.width !== undefined || options.height !== undefined) {
    return CanvasSize.Fixed
  }
  return current?.canvasSize ?? CanvasSize.MatchInput
}

function withNewInputs(
  current: ReadonlyArray<string>,
  raw: string | undefined,
  without: string | undefined = undefined,
): string[] {
  const dropped = new Set(sourceIds(without))
  return [...new Set([...current, ...sourceIds(raw)])].filter(
    (id) => !dropped.has(id),
  )
}

/**
 * The definition the flags describe. --pipeline is the whole pipeline (canvas
 * and steps). Otherwise --steps rebuilds the steps (after one empty image
 * layer for the input image), and without it a current workflow keeps its
 * pipeline. The canvas flags change the canvas and its size mode, --sources
 * adds input images and --output replaces the Output settings.
 */
function chooseDefinition(
  options: BuildOptions,
  current: WorkflowView | undefined,
): WorkflowDefinition {
  const { pipeline, steps, sources, output, without } = options
  if (pipeline !== undefined) {
    if (steps !== undefined || hasCanvasFlags(options)) {
      throw new ValidationError(
        'Give --pipeline on its own, or --steps with the canvas flags.',
      )
    }
    return {
      pipeline,
      canvasSize: chosenCanvasSize(options, current),
      inputs: withNewInputs(current?.inputs ?? [], sources, without),
      output: output ?? current?.output ?? defaultOutputSettings(),
    }
  }
  const canvas = chosenCanvas(options, current)
  const inputs = withNewInputs(current?.inputs ?? [], sources, without)
  if (current !== undefined && steps === undefined) {
    return {
      pipeline: { ...current.pipeline, canvas },
      canvasSize: chosenCanvasSize(options, current),
      inputs,
      output: output ?? current.output,
    }
  }
  return workflowDefinitionFromSteps({
    inputs,
    steps: steps ?? [],
    canvas,
    canvasSize: chosenCanvasSize(options, current),
    output: output ?? current?.output,
  })
}

export const workflowCreateCommand = defineAppCommand({
  name: 'workflow create',
  summary: 'Create a workflow',
  synopsis:
    '<name> [--canvas-size match-input|fixed] [--width <px> --height <px> --background <c>] [--sources <ids>] [--steps <json>] [--output <json>] [--pipeline <json>]',
  help: `Creates a workflow: a pipeline, like a document's, that runs on each source.
The pipeline has an empty image layer, which is where each source is drawn, and
then --steps in order: {"op":"resize","options":{"width":800}} for a Sharp
operation, {"tool":"upscale","settings":{...}} for an AI tool. The canvas takes
the size of each input image, as a document opened on it would, unless you give
it a size (--width, --height) or --canvas-size fixed, which keeps 1920x1080. With --pipeline you give the whole pipeline
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
    '<id> [--name <name>] [--canvas-size match-input|fixed] [--width <px> --height <px> --background <c>] [--sources <ids>] [--without <ids>] [--steps <json>] [--output <json>] [--pipeline <json>]',
  help: `Changes a workflow as it is now, as one change in its Edit history (undo it
with workflow undo). A new --name is a rename, which is not in it. The canvas flags change the canvas and what you
leave out stays; a width or height makes the canvas fixed unless --canvas-size
says otherwise. --sources adds source images and --output replaces the Output
settings. --steps replaces the steps after one empty image layer. --pipeline
replaces the whole pipeline.

Options:
  --name <name>        Rename the workflow
${CANVAS_HELP}
  ${SOURCES_HELP}
  --without <ids>      Comma-separated source ids to take out of the workflow's sources
  --steps <json>       The steps after the input layer (${JSON_FLAG})
  ${OUTPUT_HELP}
  --pipeline <json>    The whole pipeline (${JSON_FLAG}); not with --steps or the canvas flags`,
  shape: { id, name: z.string().min(1).optional(), ...BUILD_SHAPE },
  positionals: ['id'],
  flags: { name: { type: 'string' }, ...BUILD_FLAGS },
  async run({ app, actor, options }) {
    const current = await app.workflows.get(actor, options.id)
    const definition = chooseDefinition(options, current)
    let workflow = await app.workflows.change(
      actor,
      options.id,
      current.revision,
      { type: 'replace', definition },
    )
    if (options.name !== undefined && options.name !== current.name) {
      workflow = await app.workflows.rename(actor, options.id, options.name)
    }
    return { workflow }
  },
})

export const workflowRenameCommand = defineAppCommand({
  name: 'workflow rename',
  summary: 'Rename a workflow',
  synopsis: '<id> <name>',
  help: 'Gives the workflow a new name, as double-clicking it in the sidebar does, and prints the workflow. A rename is not an edit: it is not in the Edit history.',
  shape: { id, name: z.string() },
  positionals: ['id', 'name'],
  async run({ app, actor, options }) {
    return {
      workflow: await app.workflows.rename(actor, options.id, options.name),
    }
  },
})

export const workflowUndoCommand = defineAppCommand({
  name: 'workflow undo',
  summary: 'Undo the last change to a workflow',
  synopsis: '<id>',
  help: 'Undoes the last change in the workflow’s Edit history, if any, and prints the workflow.',
  shape: { id },
  positionals: ['id'],
  async run({ app, actor, options }) {
    const current = await app.workflows.get(actor, options.id)
    return {
      workflow: await app.workflows.undo(actor, options.id, current.revision),
    }
  },
})

export const workflowRedoCommand = defineAppCommand({
  name: 'workflow redo',
  summary: 'Redo a change that was undone',
  synopsis: '<id>',
  help: 'Redoes the change that was undone last, if any, and prints the workflow.',
  shape: { id },
  positionals: ['id'],
  async run({ app, actor, options }) {
    const current = await app.workflows.get(actor, options.id)
    return {
      workflow: await app.workflows.redo(actor, options.id, current.revision),
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
    '<id> [--sources <ids>] [--follow] [--out <folder>] [--existing <policy>] [--manifest]',
  help: `Starts a run: one job per source, each source drawn in the workflow's input
layer, on a canvas of its own size or the workflow's fixed one, as the
workflow's canvas size says. --sources runs on some of the workflow's sources
only; without it the run takes them all. Without --follow the run is queued and this
returns at once; the server or a \`worker\` process does the work. With --follow
this process does the work, waits for the run to end and, with --out, writes the
images.

Options:
  --sources <ids>      Comma-separated ids of the workflow's sources to run on
  --follow             Do the work here and wait for the run to end
${OUTPUT_FLAG_HELP}`,
  shape: {
    id,
    sources: z.string().optional(),
    follow: z.boolean().default(false),
    ...OUTPUT_SHAPE,
  },
  positionals: ['id'],
  flags: {
    sources: { type: 'string' },
    follow: { type: 'boolean' },
    ...OUTPUT_FLAGS,
  },
  async run({ app, actor, options }) {
    if (options.out !== undefined && !options.follow) {
      throw new ValidationError(
        '--out needs --follow, so the images exist when they are written.',
      )
    }
    const started = await app.workflows.run(
      actor,
      options.id,
      options.sources === undefined
        ? {}
        : { sourceIds: sourceIds(options.sources) },
    )
    if (!options.follow) return { run: started }
    return withWorkers(app, async () => {
      const run = await waitForRun(app, actor, started.id)
      return { run, files: await written(app, actor, run.id, options) }
    })
  },
})

export const workflowPreviewCommand = defineAppCommand({
  name: 'workflow preview',
  summary: 'Write the large picture of a workflow node to a file',
  synopsis:
    '<id> --out <path> [--node <id>] [--region <x,y,w,h>] [--width <px>]',
  help: `Writes the large picture the workflow page shows beside the diagram for a
node, so it can be looked at without the website. It is the workflow's last
source drawn in its input layer, through the steps up to and including the
node; AI steps are left out, as in the diagram's small pictures. The file type
follows the extension of --out (.webp, .png, .jpg); a folder uses the
workflow's name. Prints the file and the picture's size in its own pixels,
whatever size the file is written at.

Options:
  --out <path>         Where to write the picture (required)
  --node <id>          A step id, or canvas, inputs or output (default: output)
  --region <x,y,w,h>   Only this part of the picture, as fractions from 0 to 1
  --width <px>         Shrink the picture to this width (never enlarged)`,
  shape: {
    id,
    out: z.string().min(1),
    node: z.string().min(1).optional(),
    region: z.string().min(1).transform(parseRegion).optional(),
    width: z.coerce.number().int().positive().optional(),
  },
  positionals: ['id'],
  flags: {
    out: { type: 'string' },
    node: { type: 'string' },
    region: { type: 'string' },
    width: { type: 'string' },
  },
  run: ({ app, actor, options }) =>
    withWorkers(app, async () => ({
      preview: await writeWorkflowPreview(app, actor, options.id, options.out, {
        nodeId: options.node,
        region: options.region,
        width: options.width,
      }),
    })),
})

export const workflowResultsCommand = defineAppCommand({
  name: 'workflow results',
  summary: 'Write what a run made to a folder',
  synopsis:
    '<runId> (--out <folder> [--existing <policy>] [--manifest] | --zip <file>)',
  help: `Writes the finished images of a run into a folder, named as the workflow's
Output settings named them, or with --zip into one zip file, as the website's
Download all does (two images of the same name are numbered). Items still
running are left out.

Options:
${OUTPUT_FLAG_HELP}
  --zip <file>         Write the images into this zip file instead`,
  shape: { runId: id, zip: z.string().min(1).optional(), ...OUTPUT_SHAPE },
  positionals: ['runId'],
  flags: { zip: { type: 'string' }, ...OUTPUT_FLAGS },
  async run({ app, actor, options }) {
    if (options.zip !== undefined) {
      if (options.out !== undefined) {
        throw new ValidationError(
          'Give --out <folder> or --zip <file>, not both.',
        )
      }
      const destination = path.resolve(options.zip)
      const archive = await app.workflows.writeRunArchive(
        actor,
        options.runId,
        destination,
      )
      return { archive: { ...archive, path: destination } }
    }
    if (options.out === undefined) {
      throw new ValidationError('Give --out <folder> or --zip <file>.')
    }
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
