import path from 'node:path'

import { z } from 'zod'

import { defineAppCommand } from '../app-command.ts'

const id = z.string().min(1)

export const documentCreateCommand = defineAppCommand({
  name: 'document create',
  summary: 'Create a document from a source',
  synopsis: '<sourceId> [--name <name>]',
  help: `Creates an editable document (an empty pipeline and its undo history) on a
source. The name defaults to the source's file name without its extension.

Options:
  --name <name>        Name the document`,
  shape: { sourceId: id, name: z.string().optional() },
  positionals: ['sourceId'],
  flags: { name: { type: 'string' } },
  async run({ app, actor, options }) {
    return {
      document: await app.documents.create(
        actor,
        options.sourceId,
        options.name,
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
  synopsis: '<id>',
  help: 'Undoes the last change, if any, and prints the document.',
  shape: { id },
  positionals: ['id'],
  async run({ app, actor, options }) {
    const current = await app.documents.get(actor, options.id)
    return {
      document: await app.documents.undo(actor, options.id, current.revision),
    }
  },
})

export const documentRedoCommand = defineAppCommand({
  name: 'document redo',
  summary: 'Redo a change that was undone',
  synopsis: '<id>',
  help: 'Redoes the change that was undone last, if any, and prints the document.',
  shape: { id },
  positionals: ['id'],
  async run({ app, actor, options }) {
    const current = await app.documents.get(actor, options.id)
    return {
      document: await app.documents.redo(actor, options.id, current.revision),
    }
  },
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
