import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { ValidationError } from '../../../src/server/errors.ts'
import { toSourceSummary } from '../../../src/server/services/source-service.ts'
import { defineAppCommand } from '../app-command.ts'

export const sourceAddCommand = defineAppCommand({
  name: 'source add',
  summary: 'Upload an image from disk as a source',
  synopsis: '<path>',
  help: `Uploads the image at <path> (PNG, JPEG, WebP, AVIF or GIF) as a source and
prints it. A source is kept exactly as uploaded; documents and workflows refer
to it by id. Uploading the same image again returns the same source.`,
  shape: { path: z.string().min(1) },
  positionals: ['path'],
  async run({ app, actor, options }) {
    const file = path.resolve(options.path)
    const info = await stat(file).catch(() => undefined)
    if (info === undefined || !info.isFile()) {
      throw new ValidationError('That file does not exist.')
    }
    const source = await app.sources.upload(
      actor,
      createReadStream(file),
      path.basename(file),
    )
    return { source: toSourceSummary(source) }
  },
})

export const sourceListCommand = defineAppCommand({
  name: 'source list',
  summary: 'List your sources',
  synopsis: '',
  help: 'Lists your uploaded images, newest first.',
  shape: {},
  async run({ app, actor }) {
    const sources = await app.sources.list(actor)
    return { sources: sources.map(toSourceSummary) }
  },
})

export const sourceDeleteCommand = defineAppCommand({
  name: 'source delete',
  summary: 'Delete a source nothing uses',
  synopsis: '<id>',
  help: `Deletes a source. Refused while a document uses it as its image or as a
second image in a step.`,
  shape: { id: z.string().min(1) },
  positionals: ['id'],
  async run({ app, actor, options }) {
    await app.sources.delete(actor, options.id)
    return { deleted: options.id }
  },
})
