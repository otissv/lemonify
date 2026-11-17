import { z } from 'zod'

import { AiToolId, aiToolSchema } from '../../../src/features/ai/ai-tools.ts'
import type { DocumentChange } from '../../../src/features/pipeline/document-change.ts'
import { layerSettingsSchema } from '../../../src/features/pipeline/layer.ts'
import { stepBlendSchema } from '../../../src/features/pipeline/step-blend.ts'
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
import { withWorkers } from '../in-process-workers.ts'
import {
  PREVIEW_FLAGS,
  PREVIEW_HELP,
  PREVIEW_SHAPE,
  withPreview,
} from '../preview-flag.ts'
import { runAiSteps } from '../run-ai-steps.ts'
import type { AppCommandContext } from '../app-command.ts'

const id = z.string().min(1)
const json = z.record(z.string(), z.json())
const JSON_VALUE = 'JSON: inline, @file.json, or - for stdin'

type StepContext<T> = AppCommandContext<T>

/** Applies one change to the document as it is now and prints the result. */
function change<T extends { documentId: string; preview?: string | undefined }>(
  context: StepContext<T>,
  build: (current: DocumentView) => DocumentChange,
) {
  return withPreview(context, async () => {
    const { app, actor, options } = context
    const current = await app.documents.get(actor, options.documentId)
    const document = await app.documents.change(
      actor,
      options.documentId,
      current.revision,
      build(current),
    )
    return { document }
  })
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
  blend?: Record<string, z.infer<ReturnType<typeof z.json>>>
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
    const step = createSharpStep(input.op, input.options ?? {})
    if (input.blend === undefined) return step
    return { ...step, blend: stepBlendSchema.parse(input.blend) }
  }
  return createAiStep(
    aiToolSchema({}).parse({ tool: input.ai, settings: input.settings }),
  )
}

export const documentStepAddCommand = defineAppCommand({
  name: 'document step add',
  summary: 'Add a Sharp, AI or layer step to a document',
  synopsis:
    '<documentId> (--op <name> [--options <json>] [--blend <json>] | --ai <tool> --settings <json> | --layer <sourceId> [--settings <json>]) [--index <n>] [--preview <path>]',
  help: `Adds a step to the end of the pipeline, or at --index. A Sharp step is an operation by name
(\`${'pnpm images sharp --help'}\` and \`pnpm images schema sharp\` list them) with its
options; an AI step names a tool (${Object.values(AiToolId).join(', ')}) and its settings; a layer
is an image: the first layer that is switched on is the canvas, which the
steps after it work on, and later layers are drawn on top of everything before
them (the steps after a layer act on the picture with the layer in it). The
canvas layer's own settings are ignored. Layer settings, all optional: opacity
(0-100), blend (normal, multiply, screen, overlay, darken, lighten,
colour-dodge, colour-burn, hard-light, soft-light, difference, exclusion), fit
(inside, original, contain, cover, stretch), scale (1-1000), rotation
(-180 to 180), anchor (centre or a compass point such as northwest), x and y
(whole pixels). Boolean and joinChannel steps name their own second image.

A filter or colour step can be blended with the picture as it was before the
step: --blend takes a mode (the same as a layer's blend) and an opacity (0-100),
e.g. '{"mode":"multiply","opacity":50}'.

Options:
  --op <name>          A Sharp operation, e.g. blur or resize
  --options <json>     The operation's options (${JSON_VALUE})
  --blend <json>       Blend of a filter or colour step: mode and opacity (${JSON_VALUE})
  --ai <tool>          An AI tool
  --layer <sourceId>   Add this source as a layer
  --settings <json>    The tool's settings, or the layer's (${JSON_VALUE})
  --index <n>          Where to put the step (default: the end)
${PREVIEW_HELP}`,
  shape: {
    documentId: id,
    op: z.string().min(1).optional(),
    options: json.optional(),
    blend: json.optional(),
    ai: z.enum(AiToolId).optional(),
    settings: json.optional(),
    layer: id.optional(),
    index: z.coerce.number().int().nonnegative().optional(),
    ...PREVIEW_SHAPE,
  },
  positionals: ['documentId'],
  flags: {
    op: { type: 'string' },
    options: { type: 'string', json: true },
    blend: { type: 'string', json: true },
    ai: { type: 'string' },
    settings: { type: 'string', json: true },
    layer: { type: 'string' },
    index: { type: 'string' },
    ...PREVIEW_FLAGS,
  },
  async run(context) {
    const { op, options, blend, ai, settings, layer, index } = context.options
    const given = [op, ai, layer].filter((value) => value !== undefined)
    if (given.length !== 1) {
      throw new ValidationError('Give one of --op, --ai or --layer.')
    }
    if (blend !== undefined && op === undefined) {
      throw new ValidationError('--blend goes with --op.')
    }
    const step = newStep({ op, options, blend, ai, settings, layer })
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
  synopsis: '<documentId> <stepId> [--preview <path>]',
  help: `Removes the step from the pipeline; it can be undone.

Options:
${PREVIEW_HELP}`,
  shape: { documentId: id, stepId: id, ...PREVIEW_SHAPE },
  positionals: ['documentId', 'stepId'],
  flags: PREVIEW_FLAGS,
  run: (context) =>
    change(context, () => ({
      type: 'remove-step',
      stepId: context.options.stepId,
    })),
})

export const documentStepMoveCommand = defineAppCommand({
  name: 'document step move',
  summary: 'Move a step to another place in the pipeline',
  synopsis: '<documentId> <stepId> <to> [--preview <path>]',
  help: `Moves the step so it sits at position <to> (counting from 0) among the other steps.

Options:
${PREVIEW_HELP}`,
  shape: {
    documentId: id,
    stepId: id,
    to: z.coerce.number().int().nonnegative(),
    ...PREVIEW_SHAPE,
  },
  positionals: ['documentId', 'stepId', 'to'],
  flags: PREVIEW_FLAGS,
  run: (context) =>
    change(context, () => ({
      type: 'move-step',
      stepId: context.options.stepId,
      to: context.options.to,
    })),
})

export const documentStepSetCommand = defineAppCommand({
  name: 'document step set',
  summary: "Replace a step's options, blend, settings or image",
  synopsis:
    '<documentId> <stepId> (--options <json> | --blend <json> | --settings <json> | --source <sourceId>) [--preview <path>]',
  help: `Replaces the options of a Sharp step, the blend of a filter or colour step,
the settings of an AI step or of a layer (every layer setting not given goes
back to its default), or the image of a layer. A blend of {} takes the blend
away.

Options:
  --options <json>     New options for a Sharp step (${JSON_VALUE})
  --blend <json>       New blend, mode and opacity, for a filter or colour step (${JSON_VALUE})
  --settings <json>    New settings for an AI step or a layer (${JSON_VALUE})
  --source <sourceId>  The source a layer shows
${PREVIEW_HELP}`,
  shape: {
    documentId: id,
    stepId: id,
    options: json.optional(),
    blend: json.optional(),
    settings: json.optional(),
    source: id.optional(),
    ...PREVIEW_SHAPE,
  },
  positionals: ['documentId', 'stepId'],
  flags: {
    ...PREVIEW_FLAGS,
    options: { type: 'string', json: true },
    blend: { type: 'string', json: true },
    settings: { type: 'string', json: true },
    source: { type: 'string' },
  },
  run: (context) =>
    change(context, (current) => {
      const { stepId, options, blend, settings, source } = context.options
      return setChange(requireStep(current, stepId), {
        options,
        blend,
        settings,
        source,
      })
    }),
})

type Given = {
  options: Record<string, z.infer<ReturnType<typeof z.json>>> | undefined
  blend: Record<string, z.infer<ReturnType<typeof z.json>>> | undefined
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
  if (given.blend !== undefined) {
    return {
      type: 'set-blend',
      stepId,
      blend: stepBlendSchema.parse(given.blend),
    }
  }
  switch (step.kind) {
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
  synopsis: '<documentId> <stepId> [<name>] [--preview <path>]',
  help: `Names the step in the sidebar. Leave <name> out (or give an empty one) to go back to the tool's own name.

Options:
${PREVIEW_HELP}`,
  shape: {
    documentId: id,
    stepId: id,
    name: z.string().optional(),
    ...PREVIEW_SHAPE,
  },
  positionals: ['documentId', 'stepId', 'name'],
  flags: PREVIEW_FLAGS,
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
    synopsis: '<documentId> <stepId> [--preview <path>]',
    help: `${verb} a step. A step that is off stays in the pipeline but is not applied.

Options:
${PREVIEW_HELP}`,
    shape: { documentId: id, stepId: id, ...PREVIEW_SHAPE },
    positionals: ['documentId', 'stepId'],
    flags: PREVIEW_FLAGS,
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

export const documentStepRunCommand = defineAppCommand({
  name: 'document step run',
  summary: 'Run the AI steps of a document that have no result yet',
  synopsis: '<documentId> [<stepId>]',
  help: `Runs AI steps as the website's Run button does, one at a time and in order,
because each works on the picture the steps before it made. Give <stepId> to
run only that step; it must be the first one waiting. Prints the steps that
were run. The AI steps of a document must have results before it can be
exported.`,
  shape: { documentId: id, stepId: id.optional() },
  positionals: ['documentId', 'stepId'],
  run: ({ app, actor, options }) =>
    withWorkers(app, () =>
      runAiSteps(app, actor, options.documentId, options.stepId),
    ),
})
