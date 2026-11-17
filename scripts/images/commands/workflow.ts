import { z } from 'zod'

import { OutputSettingsSchema } from '../../../src/features/workflows/output-settings.ts'
import {
  WorkflowStepSpecsSchema,
  workflowGraphFromSteps,
} from '../../../src/features/workflows/workflow-from-steps.ts'
import { WorkflowGraphSchema } from '../../../src/features/workflows/workflow.ts'
import {
  addInputSources,
  updateOutputSettings,
} from '../../../src/features/workflows/workflow-graph.ts'
import { RunState } from '../../../src/server/dao/workflow-dao.ts'
import { ValidationError } from '../../../src/server/errors.ts'
import type { Actor } from '../../../src/server/domain/actor.ts'
import type { WorkflowView } from '../../../src/server/services/workflow-service.ts'
import type { WorkflowGraph } from '../../../src/features/workflows/workflow.ts'
import { WorkflowNodeKind } from '../../../src/features/workflows/workflow-graph.ts'
import type { App } from '../../../src/server/composition.ts'
import { defineAppCommand } from '../app-command.ts'
import { withWorkers } from '../in-process-workers.ts'
import { EXISTING_FILES, writeRunOutputs } from '../write-outputs.ts'
import type { ExistingFiles } from '../write-outputs.ts'

const id = z.string().min(1)
const WAIT_MS = 500

const GRAPH_FLAG = 'JSON: inline, @file.json, or - for stdin'
const SOURCES_HELP =
  '--sources <ids>      Comma-separated source ids to put on the Input step'
const OUTPUT_HELP =
  '--output <json>      Output settings: format, options, keepMetadata, widths, suffix'

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
  graph: WorkflowGraphSchema.optional(),
}

const BUILD_FLAGS = {
  sources: { type: 'string' },
  steps: { type: 'string', json: true },
  output: { type: 'string', json: true },
  graph: { type: 'string', json: true },
} as const

type BuildOptions = {
  sources?: string
  steps?: z.output<typeof WorkflowStepSpecsSchema>
  output?: z.output<typeof OutputSettingsSchema>
  graph?: WorkflowGraph
}

function currentParts(current: WorkflowView | undefined) {
  const sourceIds: string[] = []
  let output: z.output<typeof OutputSettingsSchema> | undefined
  for (const node of current?.nodes ?? []) {
    if (node.kind === WorkflowNodeKind.Input) sourceIds.push(...node.sourceIds)
    if (node.kind === WorkflowNodeKind.Output) output = node.settings
  }
  return { sourceIds, output }
}

/**
 * The graph the flags describe. --graph is the whole graph. Otherwise the
 * graph is rebuilt from the steps (those given, or none for a new workflow),
 * keeping the current Input sources and Output settings unless new ones are
 * given. Changing only sources or output edits the current graph in place.
 */
function chooseGraph(
  name: string,
  options: BuildOptions,
  current: WorkflowView | undefined,
): WorkflowGraph {
  const { graph, steps, sources, output } = options
  if (graph !== undefined) {
    if (steps !== undefined || sources !== undefined || output !== undefined) {
      throw new ValidationError(
        'Give --graph on its own, or --steps, --sources and --output.',
      )
    }
    return graph
  }
  if (current !== undefined && steps === undefined) {
    let next: WorkflowGraph = { nodes: current.nodes, edges: current.edges }
    if (sources !== undefined) next = addInputSources(next, sourceIds(sources))
    if (output !== undefined) next = updateOutputSettings(next, output)
    return next
  }
  const kept = currentParts(current)
  return workflowGraphFromSteps(name, {
    sourceIds: sources === undefined ? kept.sourceIds : sourceIds(sources),
    steps: steps ?? [],
    output: output ?? kept.output,
  })
}

export const workflowCreateCommand = defineAppCommand({
  name: 'workflow create',
  summary: 'Create a workflow',
  synopsis:
    '<name> [--sources <ids>] [--steps <json>] [--output <json>] [--graph <json>]',
  help: `Creates a workflow that runs its steps in order, from Input to Output.
--steps is a list: {"op":"resize","options":{"width":800}} for a Sharp
operation, {"tool":"upscale","settings":{...}} for an AI tool. With --graph you
give the whole {nodes, edges} yourself instead.

Options:
  ${SOURCES_HELP}
  --steps <json>       The steps, in order (${GRAPH_FLAG})
  ${OUTPUT_HELP}
  --graph <json>       The whole graph (${GRAPH_FLAG}); not with the three above`,
  shape: { name: z.string().min(1), ...BUILD_SHAPE },
  positionals: ['name'],
  flags: BUILD_FLAGS,
  async run({ app, actor, options }) {
    const graph = chooseGraph(options.name, options, undefined)
    return { workflow: await app.workflows.create(actor, options.name, graph) }
  },
})

export const workflowShowCommand = defineAppCommand({
  name: 'workflow show',
  summary: 'Print a workflow',
  synopsis: '<id>',
  help: 'Prints the workflow: its steps, how they connect and its Output settings.',
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
    '<id> [--name <name>] [--sources <ids>] [--steps <json>] [--output <json>] [--graph <json>]',
  help: `Changes a workflow as it is now. --sources adds sources to Input and --output
replaces the Output settings. --steps replaces the steps between them. --graph
replaces everything.

Options:
  --name <name>        Rename the workflow
  ${SOURCES_HELP}
  --steps <json>       The steps, in order (${GRAPH_FLAG})
  ${OUTPUT_HELP}
  --graph <json>       The whole graph (${GRAPH_FLAG}); not with the three above`,
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
        {
          name,
          graph: chooseGraph(name, options, current),
        },
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
    '<id> [--follow] [--out <folder>] [--existing <policy>] [--manifest]',
  help: `Starts a run: one job per source. Without --follow the run is queued and this
returns at once; the server or a \`worker\` process does the work. With --follow
this process does the work, waits for the run to end and, with --out, writes the
images.

Options:
  --follow             Do the work here and wait for the run to end
${OUTPUT_FLAG_HELP}`,
  shape: { id, follow: z.boolean().default(false), ...OUTPUT_SHAPE },
  positionals: ['id'],
  flags: { follow: { type: 'boolean' }, ...OUTPUT_FLAGS },
  async run({ app, actor, options }) {
    if (options.out !== undefined && !options.follow) {
      throw new ValidationError(
        '--out needs --follow, so the images exist when they are written.',
      )
    }
    const started = await app.workflows.run(actor, options.id)
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
