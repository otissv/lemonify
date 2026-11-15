import { z } from 'zod'

import { ResultKind } from '../../../src/server/dao/result-dao.ts'
import type { ResultRecord } from '../../../src/server/dao/result-dao.ts'
import { defineAppCommand } from '../app-command.ts'
import { saveResult } from '../save-result.ts'

const id = z.string().min(1)

function summary(record: ResultRecord) {
  return {
    id: record.id,
    kind: record.kind,
    fileName: record.fileName,
    mediaType: record.mediaType,
    bytes: record.bytes,
    documentId: record.documentId,
    stepId: record.stepId,
    workflowRunId: record.workflowRunId,
    createdAt: record.createdAt,
  }
}

export const resultListCommand = defineAppCommand({
  name: 'result list',
  summary: 'List your results',
  synopsis: '[--document <id>] [--run <id>] [--kind <kind>]',
  help: `Lists the images that cost work or that you asked for: AI step results,
exports and workflow run images. Newest first.

Options:
  --document <id>      Only this document's results
  --run <id>           Only this workflow run's results
  --kind <kind>        ${Object.values(ResultKind).join(', ')}`,
  shape: {
    document: id.optional(),
    run: id.optional(),
    kind: z.enum(ResultKind).optional(),
  },
  flags: {
    document: { type: 'string' },
    run: { type: 'string' },
    kind: { type: 'string' },
  },
  async run({ app, actor, options }) {
    const found = await app.results.list(actor, {
      documentId: options.document,
      workflowRunId: options.run,
      kind: options.kind,
    })
    return {
      results: found.map(summary),
      usedBytes: await app.results.usedBytes(actor),
    }
  },
})

export const resultShowCommand = defineAppCommand({
  name: 'result show',
  summary: 'Print one result',
  synopsis: '<id>',
  help: 'Prints one result: its kind, file name, size and what made it.',
  shape: { id },
  positionals: ['id'],
  async run({ app, actor, options }) {
    return { result: summary(await app.results.get(actor, options.id)) }
  },
})

export const resultDeleteCommand = defineAppCommand({
  name: 'result delete',
  summary: 'Delete a result',
  synopsis: '<id>',
  help: 'Deletes a result. An AI step result that is deleted runs again when it is next needed.',
  shape: { id },
  positionals: ['id'],
  async run({ app, actor, options }) {
    await app.results.delete(actor, options.id)
    return { deleted: options.id }
  },
})

export const resultSaveCommand = defineAppCommand({
  name: 'result save',
  summary: 'Write a result to disk',
  synopsis: '<id> --out <path>',
  help: `Writes a result's image to --out: a file path, or a folder to use the
result's own file name.

Options:
  --out <path>         Where to write the image (required)`,
  shape: { id, out: z.string().min(1) },
  positionals: ['id'],
  flags: { out: { type: 'string' } },
  async run({ app, actor, options }) {
    const saved = await saveResult(app, actor, options.id, options.out)
    return { id: options.id, ...saved }
  },
})

export const resultClearUnusedCommand = defineAppCommand({
  name: 'result clear-unused',
  summary: "Delete a document's AI results its pipeline no longer uses",
  synopsis: '<documentId>',
  help: `Deletes the AI step results the document's current pipeline does not use.
Exports are kept. An undo that brings a step back runs that step again.`,
  shape: { documentId: id },
  positionals: ['documentId'],
  async run({ app, actor, options }) {
    return app.renders.clearUnusedResults(actor, options.documentId)
  },
})
