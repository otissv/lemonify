import { z } from 'zod'

import type { App } from '../../src/server/composition.ts'
import type { Actor } from '../../src/server/domain/actor.ts'
import { withWorkers } from './job-workers.ts'
import { writePreview } from './preview-document.ts'
import type { PreviewPicture } from './preview-document.ts'

/** The `--preview` flag that every command that edits a document takes. */
export const PREVIEW_SHAPE = { preview: z.string().min(1).optional() }
export const PREVIEW_FLAGS = { preview: { type: 'string' } } as const
export const PREVIEW_HELP =
  '  --preview <path>     Also write the picture the document now shows to this file (.webp, .png or .jpg)'

type PreviewContext = {
  app: App
  actor: Actor
  options: { documentId?: string; id?: string; preview?: string | undefined }
}

/**
 * Runs an edit and, when `--preview` was given, writes the picture the
 * document shows afterwards, so the effect of the edit can be seen in the same
 * command. The result gains a `preview` entry naming the file.
 */
export async function withPreview<T extends object>(
  { app, actor, options }: PreviewContext,
  work: () => Promise<T>,
): Promise<T & { preview?: PreviewPicture }> {
  const destination = options.preview
  if (destination === undefined) return work()
  const documentId = options.documentId ?? options.id
  if (documentId === undefined) throw new Error('The edit names no document.')
  return withWorkers(app, async () => {
    const result = await work()
    const preview = await writePreview(app, actor, documentId, destination)
    return { ...result, preview }
  })
}
