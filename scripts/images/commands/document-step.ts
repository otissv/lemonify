import { z } from 'zod'

import { AiToolId, aiToolSchema } from '../../../src/features/ai/ai-tools.ts'
import type { DocumentChange } from '../../../src/features/pipeline/document-change.ts'
import { layerSettingsSchema } from '../../../src/features/pipeline/layer.ts'
import {
  createImageLayerStep,
  isLayerStep,
  layerKind,
} from '../../../src/features/pipeline/layer-kinds.ts'
import { stepBlendSchema } from '../../../src/features/pipeline/step-blend.ts'
import {
  createAiStep,
  createGroupStep,
  createSharpStep,
  findStep,
} from '../../../src/features/pipeline/pipeline.ts'
import { PipelineStepKind } from '../../../src/features/pipeline/pipeline.ts'
import type {
  LeafStep,
  PipelineStep,
} from '../../../src/features/pipeline/pipeline.ts'
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
export function change<
  T extends { documentId: string; preview?: string | undefined },
>(context: StepContext<T>, build: (current: DocumentView) => DocumentChange) {
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

function requireStep(current: DocumentView, stepId: string): PipelineStep {
  const found = findStep(current.pipeline, stepId)
  if (found === undefined)
    throw new ValidationError('That step is not in the pipeline.')
  return found.step
}

/** How many steps sit where a step is added or moved to: the group's, or the top level's. */
function placesIn(current: DocumentView, groupId: string | undefined): number {
  if (groupId === undefined) return current.pipeline.steps.length
  const group = requireStep(current, groupId)
  if (group.kind !== PipelineStepKind.Group) {
    throw new ValidationError('That step is not a group.')
  }
  return group.steps.length
}

function newStep(input: {
  op?: string
  options?: Record<string, z.infer<ReturnType<typeof z.json>>>
  blend?: Record<string, z.infer<ReturnType<typeof z.json>>>
  ai?: AiToolId
  settings?: Record<string, z.infer<ReturnType<typeof z.json>>>
  imageLayer?: { source: string | undefined }
}): LeafStep {
  if (input.imageLayer !== undefined) {
    return {
      ...createImageLayerStep(input.imageLayer.source),
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
  summary: 'Add a Sharp, AI or image layer step to a document',
  synopsis:
    '<documentId> (--op <name> [--options <json>] [--blend <json>] | --ai <tool> --settings <json> | --image-layer [--source <sourceId>] [--settings <json>]) [--index <n>] [--group <groupId>] [--preview <path>]',
  help: `Adds a step to the end of the pipeline, or at --index. A Sharp step is an operation by name
(\`${'pnpm images sharp --help'}\` and \`pnpm images schema sharp\` list them) with its
options; an AI step names a tool (${Object.values(AiToolId).join(', ')}) and its settings; an image
layer is an image drawn on the document's canvas, on top of everything before it
(the steps after a layer act on the picture with the layer in it). Give it a
--source, or leave the source out for an empty image layer, which keeps its
settings and draws nothing until \`document step set <id> <stepId> --source\`
gives it an image. Image layer settings, all optional: opacity
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
  --image-layer        Add an image layer
  --source <sourceId>  The source the new image layer shows (none: an empty layer)
  --settings <json>    The tool's settings, or the image layer's (${JSON_VALUE})
  --index <n>          Where to put the step (default: the end)
  --group <groupId>    Put the step inside this group (the index counts inside it)
${PREVIEW_HELP}`,
  shape: {
    documentId: id,
    op: z.string().min(1).optional(),
    options: json.optional(),
    blend: json.optional(),
    ai: z.enum(AiToolId).optional(),
    settings: json.optional(),
    imageLayer: z.boolean().default(false),
    source: id.optional(),
    index: z.coerce.number().int().nonnegative().optional(),
    group: id.optional(),
    ...PREVIEW_SHAPE,
  },
  positionals: ['documentId'],
  flags: {
    op: { type: 'string' },
    options: { type: 'string', json: true },
    blend: { type: 'string', json: true },
    ai: { type: 'string' },
    settings: { type: 'string', json: true },
    'image-layer': { type: 'boolean' },
    source: { type: 'string' },
    index: { type: 'string' },
    group: { type: 'string' },
    ...PREVIEW_FLAGS,
  },
  async run(context) {
    const {
      op,
      options,
      blend,
      ai,
      settings,
      imageLayer,
      source,
      index,
      group,
    } = context.options
    const given = [op, ai, imageLayer ? true : undefined].filter(
      (value) => value !== undefined,
    )
    if (given.length !== 1) {
      throw new ValidationError('Give one of --op, --ai or --image-layer.')
    }
    if (blend !== undefined && op === undefined) {
      throw new ValidationError('--blend goes with --op.')
    }
    if (source !== undefined && !imageLayer) {
      throw new ValidationError('--source goes with --image-layer.')
    }
    const step = newStep({
      op,
      options,
      blend,
      ai,
      settings,
      ...(imageLayer ? { imageLayer: { source } } : {}),
    })
    return change(context, (current) => ({
      type: 'add-step',
      step,
      index: index ?? placesIn(current, group),
      ...(group === undefined ? {} : { groupId: group }),
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
  synopsis: '<documentId> <stepId> <to> [--into <groupId>] [--preview <path>]',
  help: `Moves the step so it sits at position <to> (counting from 0) among the other steps.
With --into the position counts inside that group, which moves the step into it
(or within it); without it the step goes to the top level, which takes it out
of a group.

Options:
  --into <groupId>     Move the step into this group
${PREVIEW_HELP}`,
  shape: {
    documentId: id,
    stepId: id,
    to: z.coerce.number().int().nonnegative(),
    into: id.optional(),
    ...PREVIEW_SHAPE,
  },
  positionals: ['documentId', 'stepId', 'to'],
  flags: { ...PREVIEW_FLAGS, into: { type: 'string' } },
  run: (context) =>
    change(context, () => ({
      type: 'move-step',
      stepId: context.options.stepId,
      to: context.options.to,
      ...(context.options.into === undefined
        ? {}
        : { groupId: context.options.into }),
    })),
})

export const documentStepSetCommand = defineAppCommand({
  name: 'document step set',
  summary: "Replace a step's options, blend, settings or image",
  synopsis:
    '<documentId> <stepId> (--options <json> | --blend <json> | --settings <json> | --source <sourceId> | --clear-source | --sub-document <on|off>) [--preview <path>]',
  help: `Replaces the options of a Sharp step, the blend of a filter or colour step,
the settings of an AI step or of an image layer (every setting not given goes
back to its default), or the image of an image layer (--source, or
--clear-source to leave it empty). A blend of {} takes the blend away.

A group takes --sub-document on to become a picture of its own: a blank canvas
the size of the document's, which its steps draw on and act on, and the result
is placed on the document's canvas like a layer. Its --settings are then where
and how it is placed (the same as a layer's: opacity, blend, fit, scale,
rotation, anchor, x, y). With --sub-document off it goes back to being a plain
group, whose steps are part of the one picture. A sub-document with no layer
that is on is a picture with nothing in it.

Options:
  --options <json>     New options for a Sharp step (${JSON_VALUE})
  --blend <json>       New blend, mode and opacity, for a filter or colour step (${JSON_VALUE})
  --settings <json>    New settings for an AI step or an image layer (${JSON_VALUE})
  --source <sourceId>  The source an image layer shows
  --clear-source       Take the image away and leave the image layer empty
  --sub-document <on|off>  Whether a group is a picture of its own
${PREVIEW_HELP}`,
  shape: {
    documentId: id,
    stepId: id,
    options: json.optional(),
    blend: json.optional(),
    settings: json.optional(),
    source: id.optional(),
    clearSource: z.boolean().default(false),
    subDocument: z.enum(['on', 'off']).optional(),
    ...PREVIEW_SHAPE,
  },
  positionals: ['documentId', 'stepId'],
  flags: {
    ...PREVIEW_FLAGS,
    options: { type: 'string', json: true },
    blend: { type: 'string', json: true },
    settings: { type: 'string', json: true },
    source: { type: 'string' },
    'clear-source': { type: 'boolean' },
    'sub-document': { type: 'string' },
  },
  run: (context) =>
    change(context, (current) => {
      const {
        stepId,
        options,
        blend,
        settings,
        source,
        clearSource,
        subDocument,
      } = context.options
      if (source !== undefined && clearSource) {
        throw new ValidationError('Give --source or --clear-source, not both.')
      }
      return setChange(requireStep(current, stepId), {
        options,
        blend,
        settings,
        source: clearSource ? null : source,
        subDocument,
      })
    }),
})

type Given = {
  options: Record<string, z.infer<ReturnType<typeof z.json>>> | undefined
  blend: Record<string, z.infer<ReturnType<typeof z.json>>> | undefined
  settings: Record<string, z.infer<ReturnType<typeof z.json>>> | undefined
  /** An image for an image layer; null takes it away. */
  source: string | null | undefined
  subDocument: 'on' | 'off' | undefined
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
  if (isLayerStep(step)) {
    if (given.source !== undefined) {
      return { type: 'set-image', stepId, sourceId: given.source }
    }
    return {
      type: 'set-layer',
      stepId,
      settings: layerSettingsSchema.parse(
        requireGiven(
          given.settings,
          '--settings, --source or --clear-source',
          `an ${layerKind(step).title.toLowerCase()}`,
        ),
      ),
    }
  }
  switch (step.kind) {
    case PipelineStepKind.Group:
      if (given.subDocument !== undefined) {
        return {
          type: 'set-sub-document',
          stepId,
          subDocument: given.subDocument === 'on',
        }
      }
      if (given.settings !== undefined) {
        return {
          type: 'set-layer',
          stepId,
          settings: layerSettingsSchema.parse(given.settings),
        }
      }
      throw new ValidationError(
        'Give --sub-document or --settings for a group. Rename it, switch it on or off, or change the steps in it for anything else.',
      )
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

export const documentStepGroupCommand = defineAppCommand({
  name: 'document step group',
  summary: 'Put steps together in a group',
  synopsis: '<documentId> <stepIds> [--name <name>] [--preview <path>]',
  help: `Groups the steps, <stepIds> being their ids separated by commas. They must be next to each other at the top level and are
kept in their order. A group holds steps like the pipeline does, has its own
switch (off turns every step in it off) and can be named. Grouping does not
change the picture. Prints the document; the group's id is the step that holds
the others. It can be undone.

Options:
  --name <name>        Name the group
${PREVIEW_HELP}`,
  shape: {
    documentId: id,
    stepIds: id,
    name: z.string().optional(),
    ...PREVIEW_SHAPE,
  },
  positionals: ['documentId', 'stepIds'],
  flags: { ...PREVIEW_FLAGS, name: { type: 'string' } },
  run: (context) =>
    change(context, (current) => {
      const { stepIds, name } = context.options
      const members: LeafStep[] = []
      for (const stepId of stepIds.split(',')) {
        const step = requireStep(current, stepId)
        if (step.kind === PipelineStepKind.Group) {
          throw new ValidationError('A group cannot go inside a group.')
        }
        members.push(step)
      }
      return {
        type: 'group-steps',
        group: createGroupStep(members, name === '' ? undefined : name),
      }
    }),
})

export const documentStepUngroupCommand = defineAppCommand({
  name: 'document step ungroup',
  summary: 'Take the steps out of a group',
  synopsis: '<documentId> <groupId> [--preview <path>]',
  help: `Removes the group and leaves its steps where it was, in the same order. Each
keeps its own switch; a group that was off turns its steps off first, so the
picture does not change. It can be undone.

Options:
${PREVIEW_HELP}`,
  shape: { documentId: id, groupId: id, ...PREVIEW_SHAPE },
  positionals: ['documentId', 'groupId'],
  flags: PREVIEW_FLAGS,
  run: (context) =>
    change(context, () => ({
      type: 'ungroup',
      groupId: context.options.groupId,
    })),
})

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
