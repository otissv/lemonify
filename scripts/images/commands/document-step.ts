import { z } from 'zod'

import { AiToolId, aiToolSchema } from '../../../src/features/ai/ai-tools.ts'
import type { DocumentChange } from '../../../src/features/pipeline/document-change.ts'
import { layerSettingsSchema } from '../../../src/features/pipeline/layer.ts'
import type { LayerSettings } from '../../../src/features/pipeline/layer.ts'
import {
  createDocumentLayerStep,
  createImageLayerStep,
  createWorkflowLayerStep,
  isLayerStep,
  layerKind,
} from '../../../src/features/pipeline/layer-kinds.ts'
import { stepBlendSchema } from '../../../src/features/pipeline/step-blend.ts'
import {
  childSteps,
  createAiStep,
  createGroupStep,
  createSharpStep,
  findStep,
  isContainerStep,
  isGroupMember,
} from '../../../src/features/pipeline/pipeline.ts'
import { PipelineStepKind } from '../../../src/features/pipeline/pipeline.ts'
import type {
  GroupMember,
  LeafStep,
  PipelineStep,
} from '../../../src/features/pipeline/pipeline.ts'
import type { DocumentView } from '../../../src/features/documents/document.ts'
import { ValidationError } from '../../../src/server/errors.ts'
import { defineAppCommand } from '../app-command.ts'
import { withWorkers } from '../job-workers.ts'
import {
  PREVIEW_FLAGS,
  PREVIEW_HELP,
  PREVIEW_SHAPE,
  withPreview,
} from '../preview-flag.ts'
import { runAiSteps } from '../run-ai-steps.ts'
import { addWorkflowCommand } from './create-from.ts'
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

export function requireStep(
  current: DocumentView,
  stepId: string,
): PipelineStep {
  const found = findStep(current.pipeline, stepId)
  if (found === undefined)
    throw new ValidationError('That step is not in the pipeline.')
  return found.step
}

/** How many steps sit where a step is added: in the group or embedded document layer `parentId`, or at the top level. */
function placesIn(current: DocumentView, parentId: string | undefined): number {
  const steps = childSteps(current.pipeline, parentId)
  if (steps === undefined) {
    throw new ValidationError(
      'That step is not a group or an embedded document layer.',
    )
  }
  return steps.length
}

function newStep(input: {
  op?: string
  options?: Record<string, z.infer<ReturnType<typeof z.json>>>
  blend?: Record<string, z.infer<ReturnType<typeof z.json>>>
  ai?: AiToolId
  settings?: Record<string, z.infer<ReturnType<typeof z.json>>>
  imageLayer?: { source: string | undefined }
  documentLayer?: string
  workflowLayer?: { workflowId: string; source: string | undefined }
}): LeafStep {
  const layerSettings = (): LayerSettings =>
    layerSettingsSchema.parse(input.settings ?? {})
  if (input.imageLayer !== undefined) {
    return {
      ...createImageLayerStep(input.imageLayer.source),
      ...layerSettings(),
    }
  }
  if (input.documentLayer !== undefined) {
    return {
      ...createDocumentLayerStep(input.documentLayer),
      ...layerSettings(),
    }
  }
  if (input.workflowLayer !== undefined) {
    const { workflowId, source } = input.workflowLayer
    return {
      ...createWorkflowLayerStep(workflowId, source),
      ...layerSettings(),
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
  summary:
    'Add a Sharp, AI, image layer, document layer or workflow layer step, or a workflow, to a document',
  synopsis:
    '<documentId> (--op <name> [--options <json>] [--blend <json>] | --ai <tool> --settings <json> | --image-layer [--source <sourceId>] [--settings <json>] | --document-layer <documentId> [--settings <json>] | --workflow-layer <workflowId> [--source <sourceId>] [--settings <json>] | --workflow <workflowId> [--source <sourceId>]) [--index <n>] [--into <stepId>] [--preview <path>]',
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

A document layer draws another of your documents, as it is now and at its own
canvas size, and changes when that document does; a workflow layer draws one
of your workflows on the --source in its input slot (none: without an input),
at the size its canvas gives. Both take the image layer settings. A layer
cannot lead back to the document that holds it, and everything nested,
counting the documents and workflows layers use, goes at most 8 deep. A
document or workflow that a layer uses cannot be deleted until the layer is
removed.

A filter or colour step can be blended with the picture as it was before the
step: --blend takes a mode (the same as a layer's blend) and an opacity (0-100),
e.g. '{"mode":"multiply","opacity":50}'.

Options:
  --op <name>          A Sharp operation, e.g. blur or resize
  --options <json>     The operation's options (${JSON_VALUE})
  --blend <json>       Blend of a filter or colour step: mode and opacity (${JSON_VALUE})
  --ai <tool>          An AI tool
  --image-layer        Add an image layer
  --document-layer <id>
                       Add a layer that draws this document
  --workflow-layer <id>
                       Add a layer that draws this workflow on --source
  --workflow <id>      Add a copy of this workflow as an embedded document layer
                       named after it; --source fills its input slot (none: empty)
  --source <sourceId>  The source the new image layer shows (none: an empty layer),
                       or the image in a workflow layer's input slot
  --settings <json>    The tool's settings, or the layer's (${JSON_VALUE})
  --index <n>          Where to put the step (default: the end)
  --into <stepId>      Put the step inside this group or embedded document layer
                       (the index counts inside it); groups and embedded
                       document layers nest, up to 8 deep
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
    workflow: id.optional(),
    documentLayer: id.optional(),
    workflowLayer: id.optional(),
    index: z.coerce.number().int().nonnegative().optional(),
    into: id.optional(),
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
    workflow: { type: 'string' },
    'document-layer': { type: 'string' },
    'workflow-layer': { type: 'string' },
    index: { type: 'string' },
    into: { type: 'string' },
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
      into,
      workflow,
      documentLayer,
      workflowLayer,
    } = context.options
    const given = [
      op,
      ai,
      imageLayer ? true : undefined,
      documentLayer,
      workflowLayer,
      workflow,
    ].filter((value) => value !== undefined)
    if (given.length !== 1) {
      throw new ValidationError(
        'Give one of --op, --ai, --image-layer, --document-layer, --workflow-layer or --workflow.',
      )
    }
    if (workflow !== undefined) {
      return withPreview(context, async () => ({
        document: await addWorkflowCommand(context.app, context.actor, {
          ...context.options,
          workflow,
        }),
      }))
    }
    if (blend !== undefined && op === undefined) {
      throw new ValidationError('--blend goes with --op.')
    }
    if (source !== undefined && !imageLayer && workflowLayer === undefined) {
      throw new ValidationError(
        '--source goes with --image-layer, --workflow-layer or --workflow.',
      )
    }
    const step = newStep({
      op,
      options,
      blend,
      ai,
      settings,
      ...(imageLayer ? { imageLayer: { source } } : {}),
      ...(documentLayer === undefined ? {} : { documentLayer }),
      ...(workflowLayer === undefined
        ? {}
        : { workflowLayer: { workflowId: workflowLayer, source } }),
    })
    return change(context, (current) => ({
      type: 'add-step',
      step,
      index: index ?? placesIn(current, into),
      ...(into === undefined ? {} : { parentId: into }),
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
  synopsis: '<documentId> <stepId> <to> [--into <stepId>] [--preview <path>]',
  help: `Moves the step so it sits at position <to> (counting from 0) among the other steps.
With --into the position counts inside that group or embedded document layer,
which moves the step into it (or within it), at any depth; without it the step
goes to the top level. A group or an embedded document layer moves with
everything in it. A group cannot hold an embedded document layer, and nothing
can go inside itself.

Options:
  --into <stepId>      Move the step into this group or embedded document layer
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
        : { parentId: context.options.into }),
    })),
})

export const documentStepSetCommand = defineAppCommand({
  name: 'document step set',
  summary: "Replace a step's options, blend, settings or image",
  synopsis:
    '<documentId> <stepId> (--options <json> | --blend <json> | --settings <json> | --source <sourceId> | --clear-source | --embedded-document <on|off>) [--preview <path>]',
  help: `Replaces the options of a Sharp step, the blend of a filter or colour step,
the settings of an AI step or of a layer (every setting not given goes back to
its default), or the image of an image layer or in a workflow layer's input
slot (--source, or --clear-source to leave it empty); a document layer has no
image of its own. A blend of {} takes the blend away.

A group takes --embedded-document on to become an embedded document layer: a
document inside this one, with a blank canvas the size of its parent's, which
its steps draw on and act on; the result is placed on the parent like a layer.
Its --settings are where and how it is placed (the same as a layer's: opacity,
blend, fit, scale, rotation, anchor, x, y). With --embedded-document off it
goes back to being a group, whose steps are part of the picture around it, and
its placement is dropped; one that holds an embedded document layer cannot,
since a group cannot hold one. An embedded document layer with no layer that
is on is a picture with nothing in it.

Options:
  --options <json>     New options for a Sharp step (${JSON_VALUE})
  --blend <json>       New blend, mode and opacity, for a filter or colour step (${JSON_VALUE})
  --settings <json>    New settings for an AI step or a layer (${JSON_VALUE})
  --source <sourceId>  The source an image layer or a workflow layer's input slot shows
  --clear-source       Take the image away and leave the layer empty
  --embedded-document <on|off>  Whether a group is an embedded document layer
${PREVIEW_HELP}`,
  shape: {
    documentId: id,
    stepId: id,
    options: json.optional(),
    blend: json.optional(),
    settings: json.optional(),
    source: id.optional(),
    clearSource: z.boolean().default(false),
    embeddedDocument: z.enum(['on', 'off']).optional(),
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
    'embedded-document': { type: 'string' },
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
        embeddedDocument,
      } = context.options
      if (source !== undefined && clearSource) {
        throw new ValidationError('Give --source or --clear-source, not both.')
      }
      return setChange(requireStep(current, stepId), {
        options,
        blend,
        settings,
        source: clearSource ? null : source,
        embeddedDocument,
      })
    }),
})

type Given = {
  options: Record<string, z.infer<ReturnType<typeof z.json>>> | undefined
  blend: Record<string, z.infer<ReturnType<typeof z.json>>> | undefined
  settings: Record<string, z.infer<ReturnType<typeof z.json>>> | undefined
  /** An image for an image layer; null takes it away. */
  source: string | null | undefined
  embeddedDocument: 'on' | 'off' | undefined
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
  if (isContainerStep(step)) {
    if (given.embeddedDocument !== undefined) {
      return {
        type: 'set-embedded',
        stepId,
        embedded: given.embeddedDocument === 'on',
      }
    }
    if (
      given.settings !== undefined &&
      step.kind === PipelineStepKind.EmbeddedDocument
    ) {
      return {
        type: 'set-layer',
        stepId,
        settings: layerSettingsSchema.parse(given.settings),
      }
    }
    throw new ValidationError(
      step.kind === PipelineStepKind.Group
        ? 'Give --embedded-document for a group. Rename it, switch it on or off, or change the steps in it for anything else.'
        : 'Give --embedded-document or --settings for an embedded document layer. Rename it, switch it on or off, or change the steps in it for anything else.',
    )
  }
  switch (step.kind) {
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
  help: `Groups the steps, <stepIds> being their ids separated by commas. They must be next to each other in one list (the top level, a group or an embedded document layer) and are
kept in their order; the group goes where they were. A group holds steps and
other groups like the pipeline does, has its own switch (off turns every step in
it off) and can be named; it cannot hold an embedded document layer. Grouping
does not change the picture. Prints the document; the group's id is the step
that holds the others. It can be undone.

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
      const members: GroupMember[] = []
      for (const stepId of stepIds.split(',')) {
        const step = requireStep(current, stepId)
        if (!isGroupMember(step)) {
          throw new ValidationError(
            'A group cannot hold an embedded document layer.',
          )
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
  summary: 'Take the steps out of a group or an embedded document layer',
  synopsis: '<documentId> <groupId> [--preview <path>]',
  help: `Removes the group or embedded document layer and leaves its steps where it
was, in the same order. Each keeps its own switch. Taking the steps out of an
embedded document layer puts them in the picture around it, which can change
the picture; it is refused where that would put an embedded document layer
inside a group. It can be undone.

Options:
${PREVIEW_HELP}`,
  shape: { documentId: id, groupId: id, ...PREVIEW_SHAPE },
  positionals: ['documentId', 'groupId'],
  flags: PREVIEW_FLAGS,
  run: (context) =>
    change(context, () => ({
      type: 'ungroup',
      stepId: context.options.groupId,
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
