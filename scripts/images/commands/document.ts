import path from 'node:path'

import { z } from 'zod'

import { canvasSchema } from '../../../src/features/pipeline/canvas.ts'
import { ValidationError } from '../../../src/server/errors.ts'
import { defineAppCommand } from '../app-command.ts'
import {
  FROM_WORKFLOW_FLAGS,
  FROM_WORKFLOW_HELP,
  FROM_WORKFLOW_SHAPE,
  documentFromWorkflowCommand,
} from './create-from.ts'
import { withWorkers } from '../job-workers.ts'
import { writePreview } from '../preview-document.ts'
import { parseRegion } from '../region.ts'
import {
  PREVIEW_FLAGS,
  PREVIEW_HELP,
  PREVIEW_SHAPE,
  withPreview,
} from '../preview-flag.ts'

const id = z.string().min(1)

const dimension = z.coerce.number().int().positive()

export const documentCreateCommand = defineAppCommand({
  name: 'document create',
  summary: 'Create a document from a source or a workflow, or a blank one',
  synopsis:
    '(<sourceId> | --width <px> --height <px> [--background <colour>] | [<sourceId>] --from-workflow <id> [--group <stepId>] [--width <px> --height <px>]) [--name <name>]',
  help: `Creates an editable document (and its undo history). With a <sourceId> it opens
that image: the canvas is the size of the image, and the image is the first
layer. The name defaults to the source's file name without its extension.

Without a source it makes a blank document on a canvas you size, with --width
and --height in pixels and an optional --background (a colour like #ff8000, or
transparent, the default). A blank document needs --name.

With --from-workflow it makes the document from a workflow: the <sourceId>
given, or else the workflow's input image (the last one added), goes in its
first image layer, and every other step is copied. The canvas is the workflow's set size, or the input image's size when
the workflow takes each input image's size. A workflow like that with no input
image needs --width and --height.

Options:
  --name <name>        Name the document
  --width <px>         Canvas width of a blank document
  --height <px>        Canvas height of a blank document
  --background <c>     Canvas background of a blank document: #rrggbb or transparent
${FROM_WORKFLOW_HELP}`,
  shape: {
    sourceId: id.optional(),
    name: z.string().optional(),
    width: dimension.optional(),
    height: dimension.optional(),
    background: z.string().optional(),
    ...FROM_WORKFLOW_SHAPE,
  },
  positionals: ['sourceId'],
  flags: {
    name: { type: 'string' },
    width: { type: 'string' },
    height: { type: 'string' },
    background: { type: 'string' },
    ...FROM_WORKFLOW_FLAGS,
  },
  async run({ app, actor, options }) {
    const { sourceId, name, width, height, background } = options
    if (options.fromWorkflow !== undefined || options.group !== undefined) {
      return {
        document: await documentFromWorkflowCommand(app, actor, options),
      }
    }
    if (sourceId !== undefined) {
      if (
        width !== undefined ||
        height !== undefined ||
        background !== undefined
      ) {
        throw new ValidationError(
          'A document opened from a source takes its canvas from the image. Use `document canvas` to change it afterwards.',
        )
      }
      return { document: await app.documents.create(actor, sourceId, name) }
    }
    if (width === undefined || height === undefined) {
      throw new ValidationError(
        'Give a <sourceId>, or --width and --height for a blank document.',
      )
    }
    if (name === undefined) {
      throw new ValidationError('Give --name for a blank document.')
    }
    return {
      document: await app.documents.createBlank(
        actor,
        canvasSchema.parse({ width, height, background }),
        name,
      ),
    }
  },
})

export const documentListCommand = defineAppCommand({
  name: 'document list',
  summary: 'List your documents',
  synopsis: '',
  help: 'Lists your documents, most recently changed first.',
  shape: {},
  async run({ app, actor }) {
    return { documents: await app.documents.list(actor) }
  },
})

export const documentShowCommand = defineAppCommand({
  name: 'document show',
  summary: 'Print a document with its pipeline',
  synopsis: '<id>',
  help: 'Prints the document: its source, its pipeline of steps, its revision and whether it can undo or redo.',
  shape: { id },
  positionals: ['id'],
  async run({ app, actor, options }) {
    return { document: await app.documents.get(actor, options.id) }
  },
})

export const documentRenameCommand = defineAppCommand({
  name: 'document rename',
  summary: 'Rename a document',
  synopsis: '<id> <name>',
  help: 'Gives the document a new name, as double-clicking it in the sidebar does, and prints the document.',
  shape: { id, name: z.string() },
  positionals: ['id', 'name'],
  async run({ app, actor, options }) {
    return {
      document: await app.documents.rename(actor, options.id, options.name),
    }
  },
})

export const documentMoveCommand = defineAppCommand({
  name: 'document move',
  summary: 'Move a document to another place in your list',
  synopsis: '<id> <to>',
  help: 'Moves the document so it sits at position <to> (counting from 0) among your documents, as dragging it in the sidebar does, and prints the new order.',
  shape: { id, to: z.coerce.number().int().nonnegative() },
  positionals: ['id', 'to'],
  async run({ app, actor, options }) {
    await app.documents.move(actor, options.id, options.to)
    return { documents: await app.documents.list(actor) }
  },
})

export const documentDeleteCommand = defineAppCommand({
  name: 'document delete',
  summary: 'Delete a document',
  synopsis: '<id>',
  help: `Deletes a document, its history and the AI results made from it. The source
is kept.`,
  shape: { id },
  positionals: ['id'],
  async run({ app, actor, options }) {
    await app.documents.delete(actor, options.id)
    return { deleted: options.id }
  },
})

export const documentUndoCommand = defineAppCommand({
  name: 'document undo',
  summary: 'Undo the last change to a document',
  synopsis: '<id> [--preview <path>]',
  help: `Undoes the last change, if any, and prints the document.

Options:
${PREVIEW_HELP}`,
  shape: { id, ...PREVIEW_SHAPE },
  positionals: ['id'],
  flags: PREVIEW_FLAGS,
  run: (context) =>
    withPreview(context, async () => {
      const { app, actor, options } = context
      const current = await app.documents.get(actor, options.id)
      return {
        document: await app.documents.undo(actor, options.id, current.revision),
      }
    }),
})

export const documentRedoCommand = defineAppCommand({
  name: 'document redo',
  summary: 'Redo a change that was undone',
  synopsis: '<id> [--preview <path>]',
  help: `Redoes the change that was undone last, if any, and prints the document.

Options:
${PREVIEW_HELP}`,
  shape: { id, ...PREVIEW_SHAPE },
  positionals: ['id'],
  flags: PREVIEW_FLAGS,
  run: (context) =>
    withPreview(context, async () => {
      const { app, actor, options } = context
      const current = await app.documents.get(actor, options.id)
      return {
        document: await app.documents.redo(actor, options.id, current.revision),
      }
    }),
})

export const documentPreviewCommand = defineAppCommand({
  name: 'document preview',
  summary: 'Write the picture the canvas shows to a file',
  synopsis:
    '<id> --out <path> [--original] [--before-step <id>] [--region <x,y,w,h>] [--width <px>]',
  help: `Writes the picture the editor's canvas would show for the document, so it can
be looked at without the website. It is made by the same preview the editor
asks for. The file type follows the extension of --out (.webp, .png, .jpg); a
folder uses the document's name. Prints the file, the AI steps still waiting
for a result (the picture shows the pipeline only up to the first of them) and
the steps left out of the picture, with why. It also prints the picture's size
in its own pixels, whatever size the file is written at. For the full-size
picture use export.

Options:
  --out <path>         Where to write the picture (required)
  --original           The image as opened, before any step
  --before-step <id>   The picture this step acts on, made of the steps ahead of
                       it: what the editor shows while the step is open, and
                       what the numbers of a step such as extract refer to
  --region <x,y,w,h>   Only this part of the picture: x, y, width and height as
                       fractions from 0 to 1, e.g. 0.25,0.25,0.5,0.5 for the
                       middle quarter. Taken before --width shrinks it
  --width <px>         Shrink the picture to this width (never enlarged)`,
  shape: {
    id,
    out: z.string().min(1),
    original: z.boolean().default(false),
    beforeStep: z.string().min(1).optional(),
    region: z.string().min(1).transform(parseRegion).optional(),
    width: z.coerce.number().int().positive().optional(),
  },
  positionals: ['id'],
  flags: {
    out: { type: 'string' },
    original: { type: 'boolean' },
    'before-step': { type: 'string' },
    region: { type: 'string' },
    width: { type: 'string' },
  },
  run: ({ app, actor, options }) =>
    withWorkers(app, async () => ({
      preview: await writePreview(app, actor, options.id, options.out, {
        original: options.original,
        beforeStepId: options.beforeStep,
        region: options.region,
        width: options.width,
      }),
    })),
})

export const documentExportCommand = defineAppCommand({
  name: 'document export',
  summary: 'Write a document to a file another machine can open',
  synopsis: '<id> --out <path>',
  help: `Writes the document itself (its pipeline, the images it uses and the AI results
already made for it) to one file, so it can be opened elsewhere without running
the AI steps again. This is not the finished image; use \`export\` for that.

Options:
  --out <path>         Where to write the file (required); a folder uses the
                       document's name with a .lemon extension`,
  shape: { id, out: z.string().min(1) },
  positionals: ['id'],
  flags: { out: { type: 'string' } },
  async run({ app, actor, options }) {
    const target = await app.bundles.resolveDestination(
      actor,
      options.id,
      path.resolve(options.out),
    )
    const exported = await app.bundles.exportDocument(actor, options.id, target)
    return { path: target, ...exported }
  },
})

export const documentImportCommand = defineAppCommand({
  name: 'document import',
  summary: 'Open a document file as a new document',
  synopsis: '<file>',
  help: `Reads a file made by \`document export\` and makes a new document from it,
keeping its images and AI results as yours.`,
  shape: { file: z.string().min(1) },
  positionals: ['file'],
  async run({ app, actor, options }) {
    return app.bundles.importDocument(actor, path.resolve(options.file))
  },
})
