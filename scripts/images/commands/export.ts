import { z } from 'zod'

import {
  EXPORT_FORMAT_LABELS,
  ExportFormat,
  ExportSettingsSchema,
} from '../../../src/features/export/export-settings.ts'
import { JobKind } from '../../../src/server/jobs/job-types.ts'
import { defineAppCommand } from '../app-command.ts'
import { withWorkers } from '../in-process-workers.ts'
import { saveResult } from '../save-result.ts'

const OPTION_VALUES = z.record(
  z.string(),
  z.union([z.number(), z.boolean(), z.string()]),
)

export const exportCommand = defineAppCommand({
  name: 'export',
  summary: 'Export a document as a finished image',
  synopsis:
    '<documentId> --out <path> [--format <name>] [--options <json>] [--width <px>]',
  help: `Renders the document's pipeline at full size and writes the image to --out
(a file path, or a folder to use the image's own name). AI steps must already
have results; run them first with 'document step run'. The export is also kept as a result.

Options:
  --out <path>         Where to write the image (required)
  --format <name>      ${Object.values(ExportFormat).join(', ')} (default: original);
                       'export formats' lists the ones this machine can write
  --options <json>     The format's options (JSON: inline, @file.json, or - for stdin)
  --metadata           Keep the image's metadata
  --width <px>         Resize to this width`,
  shape: {
    documentId: z.string().min(1),
    out: z.string().min(1),
    format: z.enum(ExportFormat).default(ExportFormat.Original),
    options: OPTION_VALUES.default({}),
    metadata: z.boolean().default(false),
    width: z.coerce.number().int().positive().optional(),
  },
  positionals: ['documentId'],
  flags: {
    out: { type: 'string' },
    format: { type: 'string' },
    options: { type: 'string', json: true },
    metadata: { type: 'boolean' },
    width: { type: 'string' },
  },
  async run({ app, actor, options }) {
    const settings = ExportSettingsSchema.parse({
      format: options.format,
      options: options.options,
      keepMetadata: options.metadata,
    })
    return withWorkers(app, async () => {
      const queued = await app.renders.requestExport(
        actor,
        options.documentId,
        settings,
        options.width,
      )
      const done = await app.jobs.waitFor(actor, queued.id)
      if (done.result?.kind !== JobKind.Export) {
        throw new Error('The export finished without a result.')
      }
      const saved = await saveResult(
        app,
        actor,
        done.result.resultId,
        options.out,
      )
      return { resultId: done.result.resultId, ...saved }
    })
  },
})

const FORMAT_COLUMN = 12

function formatFormats({ formats }: { formats: ExportFormat[] }): string {
  const lines: string[] = []
  for (const format of formats) {
    lines.push(`${format.padEnd(FORMAT_COLUMN)}${EXPORT_FORMAT_LABELS[format]}`)
  }
  return lines.join('\n')
}

export const exportFormatsCommand = defineAppCommand({
  name: 'export formats',
  summary: 'List the formats this machine can export to',
  synopsis: '',
  help: `Lists the formats 'export --format' can write on this machine, in the order\nthe export picker shows them. Sharp builds differ, so each format is tried on\na tiny image once.`,
  shape: {},
  async run({ app }) {
    return { formats: await app.renders.exportFormats() }
  },
  format: formatFormats,
})
