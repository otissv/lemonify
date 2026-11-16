import { z } from 'zod'

import { AiToolId, aiToolSchema } from '../../../src/features/ai/ai-tools.ts'
import type { DocumentChange } from '../../../src/features/pipeline/document-change.ts'
import { layerSettingsSchema } from '../../../src/features/pipeline/layer.ts'
import {
  createAiStep,
  createLayerStep,
  createSharpStep,
} from '../../../src/features/pipeline/pipeline.ts'
import { PipelineStepKind } from '../../../src/features/pipeline/pipeline.ts'
import type { PipelineStep } from '../../../src/features/pipeline/pipeline.ts'
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

function newStep(input: {
  op?: string
  options?: Record<string, z.infer<ReturnType<typeof z.json>>>
  ai?: AiToolId
  settings?: Record<string, z.infer<ReturnType<typeof z.json>>>
  layer?: string
}): PipelineStep {
  if (input.layer !== undefined) {
    return {
      ...createLayerStep(input.layer),
      ...layerSettingsSchema.parse(input.settings ?? {}),
    }
  }
  if (input.op !== undefined) {
    return createSharpStep(input.op, input.options ?? {})
  }
  return createAiStep(
    aiToolSchema({}).parse({ tool: input.ai, settings: input.settings }),
  )
}

export const documentStepAddCommand = defineAppCommand({
  name: 'document step add',
  summary: 'Add a Sharp, AI or layer step to a document',
  synopsis:
    '<documentId> (--op <name> [--options <json>] | --ai <tool> --settings <json> | --layer <sourceId> [--settings <json>]) [--index <n>]',
  help: `Adds a step to the end of the pipeline, or at --index (never before the
document's image, which is step 0). A Sharp step is an operation by name
(\`${'pnpm images sharp --help'}\` and \`pnpm images schema sharp\` list them) with its
options; an AI step names a tool (${Object.values(AiToolId).join(', ')}) and its settings; a layer
draws another image on top of everything before it, and the steps after it act
on the picture with the layer in it. Layer settings, all optional: opacity
(0-100), blend (normal, multiply, screen, overlay, darken, lighten,
colour-dodge, colour-burn, hard-light, soft-light, difference, exclusion), fit
(inside, original, contain, cover, stretch), scale (1-1000), rotation
(-180 to 180), anchor (centre or a compass point such as northwest), x and y
(whole pixels). Boolean and joinChannel steps name their own second image.

Options:
  --op <name>          A Sharp operation, e.g. blur or resize
  --options <json>     The operation's options (${JSON_VALUE})
  --ai <tool>          An AI tool
  --layer <sourceId>   Add this source as a layer
  --settings <json>    The tool's settings, or the layer's (${JSON_VALUE})
  --index <n>          Where to put the step (default: the end)`,
  shape: {
    documentId: id,
    op: z.string().min(1).optional(),
    options: json.optional(),
    ai: z.enum(AiToolId).optional(),
    settings: json.optional(),
    layer: id.optional(),
    index: z.coerce.number().int().nonnegative().optional(),
  },
  positionals: ['documentId'],
  flags: {
    op: { type: 'string' },
    options: { type: 'string', json: true },
    ai: { type: 'string' },
    settings: { type: 'string', json: true },
    layer: { type: 'string' },
    index: { type: 'string' },
  },
  async run(context) {
    const { op, options, ai, settings, layer, index } = context.options
    const given = [op, ai, layer].filter((value) => value !== undefined)
    if (given.length !== 1) {
      throw new ValidationError('Give one of --op, --ai or --layer.')
    }
    const step = newStep({ op, options, ai, settings, layer })
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
  summary: "Replace a step's options, settings or image",
  synopsis:
    '<documentId> <stepId> (--options <json> | --settings <json> | --source <sourceId>)',
  help: `Replaces the options of a Sharp step, the settings of an AI step or of a layer
(every layer setting not given goes back to its default), or the image of a
layer or of the document itself (step 0).

Options:
  --options <json>     New options for a Sharp step (${JSON_VALUE})
  --settings <json>    New settings for an AI step or a layer (${JSON_VALUE})
  --source <sourceId>  The source a layer or the document's image shows`,
  shape: {
    documentId: id,
    stepId: id,
    options: json.optional(),
    settings: json.optional(),
    source: id.optional(),
  },
  positionals: ['documentId', 'stepId'],
  flags: {
    options: { type: 'string', json: true },
    settings: { type: 'string', json: true },
    source: { type: 'string' },
  },
  run: (context) =>
    change(context, (current) => {
      const { stepId, options, settings, source } = context.options
      return setChange(requireStep(current, stepId), {
        options,
        settings,
        source,
      })
    }),
})

type Given = {
  options: Record<string, z.infer<ReturnType<typeof z.json>>> | undefined
  settings: Record<string, z.infer<ReturnType<typeof z.json>>> | undefined
  source: string | undefined
}

function requireGiven<T>(value: T | undefined, flag: string, what: string): T {
  if (value === undefined) {
    throw new ValidationError(`Give ${flag} for ${what}.`)
  }
  return value
}

function setChange(step: PipelineStep, given: Given): DocumentChange {
  const stepId = step.id
  switch (step.kind) {
    case PipelineStepKind.Source:
      return {
        type: 'set-source',
        stepId,
        sourceId: requireGiven(
          given.source,
          '--source',
          'the document’s image',
        ),
      }
    case PipelineStepKind.Layer:
      if (given.source !== undefined) {
        return { type: 'set-source', stepId, sourceId: given.source }
      }
      return {
        type: 'set-layer',
        stepId,
        settings: layerSettingsSchema.parse(
          requireGiven(given.settings, '--settings or --source', 'a layer'),
        ),
      }
    case PipelineStepKind.Sharp:
      return {
        type: 'set-options',
        stepId,
        options: requireGiven(given.options, '--options', 'a Sharp step'),
      }
    case PipelineStepKind.Ai: {
      const settings = requireGiven(given.settings, '--settings', 'an AI step')
      const content = aiToolSchema({}).parse({ tool: step.tool, settings })
      return { type: 'set-settings', stepId, ...content }
    }
  }
}

export const documentStepRenameCommand = defineAppCommand({
  name: 'document step rename',
  summary: 'Give a step a name, or take its name away',
  synopsis: '<documentId> <stepId> [<name>]',
  help: "Names the step in the sidebar. Leave <name> out (or give an empty one) to go back to the tool's own name.",
  shape: { documentId: id, stepId: id, name: z.string().optional() },
  positionals: ['documentId', 'stepId', 'name'],
  run: (context) =>
    change(context, () => ({
      type: 'rename-step',
      stepId: context.options.stepId,
      name: context.options.name ?? '',
    })),
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
