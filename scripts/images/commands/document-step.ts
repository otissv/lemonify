import { z } from 'zod'

import { AiToolId, aiToolSchema } from '../../../src/features/ai/ai-tools.ts'
import type { DocumentChange } from '../../../src/features/pipeline/document-change.ts'
import {
  createAiStep,
  createSharpStep,
} from '../../../src/features/pipeline/pipeline.ts'
import { PipelineStepKind } from '../../../src/features/pipeline/pipeline.ts'
import type { DocumentView } from '../../../src/features/documents/document.ts'
import { ValidationError } from '../../../src/server/errors.ts'
import { defineAppCommand } from '../app-command.ts'
import type { AppCommandContext } from '../app-command.ts'

const id = z.string().min(1)
const json = z.record(z.string(), z.json())
const JSON_VALUE = 'JSON: inline, @file.json, or - for stdin'

type StepContext<T> = AppCommandContext<T>

/** Applies one change to the document as it is now and prints the result. */
async function change<T extends { documentId: string }>(
  { app, actor, options }: StepContext<T>,
  build: (current: DocumentView) => DocumentChange,
): Promise<{ document: DocumentView }> {
  const current = await app.documents.get(actor, options.documentId)
  const document = await app.documents.change(
    actor,
    options.documentId,
    current.revision,
    build(current),
  )
  return { document }
}

function requireStep(current: DocumentView, stepId: string) {
  const step = current.pipeline.steps.find(
    ({ id: candidate }) => candidate === stepId,
  )
  if (step === undefined)
    throw new ValidationError('That step is not in the pipeline.')
  return step
}

export const documentStepAddCommand = defineAppCommand({
  name: 'document step add',
  summary: 'Add a Sharp or AI step to a document',
  synopsis:
    '<documentId> (--op <name> [--options <json>] | --ai <tool> --settings <json>) [--index <n>]',
  help: `Adds a step to the end of the pipeline, or at --index. A Sharp step is an
operation by name (\`${'pnpm images sharp --help'}\` and \`pnpm images schema sharp\`
list them) with its options; an AI step names a tool (${Object.values(AiToolId).join(', ')}) and its settings.

Options:
  --op <name>          A Sharp operation, e.g. blur or resize
  --options <json>     The operation's options (${JSON_VALUE})
  --ai <tool>          An AI tool
  --settings <json>    The tool's settings (${JSON_VALUE})
  --index <n>          Where to put the step (default: the end)`,
  shape: {
    documentId: id,
    op: z.string().min(1).optional(),
    options: json.optional(),
    ai: z.enum(AiToolId).optional(),
    settings: json.optional(),
    index: z.coerce.number().int().nonnegative().optional(),
  },
  positionals: ['documentId'],
  flags: {
    op: { type: 'string' },
    options: { type: 'string', json: true },
    ai: { type: 'string' },
    settings: { type: 'string', json: true },
    index: { type: 'string' },
  },
  async run(context) {
    const { op, options, ai, settings, index } = context.options
    if ((op === undefined) === (ai === undefined)) {
      throw new ValidationError('Give either --op or --ai.')
    }
    const step =
      op === undefined
        ? createAiStep(aiToolSchema({}).parse({ tool: ai, settings }))
        : createSharpStep(op, options ?? {})
    return change(context, (current) => ({
      type: 'add-step',
      step,
      index: index ?? current.pipeline.steps.length,
    }))
  },
})

export const documentStepRemoveCommand = defineAppCommand({
  name: 'document step remove',
  summary: 'Remove a step from a document',
  synopsis: '<documentId> <stepId>',
  help: 'Removes the step from the pipeline; it can be undone.',
  shape: { documentId: id, stepId: id },
  positionals: ['documentId', 'stepId'],
  run: (context) =>
    change(context, () => ({
      type: 'remove-step',
      stepId: context.options.stepId,
    })),
})

export const documentStepMoveCommand = defineAppCommand({
  name: 'document step move',
  summary: 'Move a step to another place in the pipeline',
  synopsis: '<documentId> <stepId> <to>',
  help: 'Moves the step so it sits at position <to> (counting from 0) among the other steps.',
  shape: {
    documentId: id,
    stepId: id,
    to: z.coerce.number().int().nonnegative(),
  },
  positionals: ['documentId', 'stepId', 'to'],
  run: (context) =>
    change(context, () => ({
      type: 'move-step',
      stepId: context.options.stepId,
      to: context.options.to,
    })),
})

export const documentStepSetCommand = defineAppCommand({
  name: 'document step set',
  summary: "Replace a step's options or settings",
  synopsis: '<documentId> <stepId> (--options <json> | --settings <json>)',
  help: `Replaces the options of a Sharp step or the settings of an AI step.

Options:
  --options <json>     New options for a Sharp step (${JSON_VALUE})
  --settings <json>    New settings for an AI step (${JSON_VALUE})`,
  shape: {
    documentId: id,
    stepId: id,
    options: json.optional(),
    settings: json.optional(),
  },
  positionals: ['documentId', 'stepId'],
  flags: {
    options: { type: 'string', json: true },
    settings: { type: 'string', json: true },
  },
  run: (context) =>
    change(context, (current) => {
      const { stepId, options, settings } = context.options
      const step = requireStep(current, stepId)
      if (step.kind === PipelineStepKind.Sharp) {
        if (options === undefined)
          throw new ValidationError('Give --options for a Sharp step.')
        return { type: 'set-options', stepId, options }
      }
      if (settings === undefined)
        throw new ValidationError('Give --settings for an AI step.')
      const content = aiToolSchema({}).parse({ tool: step.tool, settings })
      return { type: 'set-settings', stepId, ...content }
    }),
})

function enabling(name: string, enabled: boolean) {
  const verb = enabled ? 'Switch on' : 'Switch off'
  return defineAppCommand({
    name,
    summary: `${verb} a step`,
    synopsis: '<documentId> <stepId>',
    help: `${verb} a step. A step that is off stays in the pipeline but is not applied.`,
    shape: { documentId: id, stepId: id },
    positionals: ['documentId', 'stepId'],
    run: (context) =>
      change(context, () => ({
        type: 'set-enabled',
        stepId: context.options.stepId,
        enabled,
      })),
  })
}

export const documentStepEnableCommand = enabling('document step enable', true)
export const documentStepDisableCommand = enabling(
  'document step disable',
  false,
)
