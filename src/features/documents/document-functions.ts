import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { DocumentChangeSchema } from '@/features/pipeline/document-change'
import { PROTECTED_CHAIN } from '@/server/http/chains'
import { appFor } from '@/server/http/server-fn-context'

import type {
  DocumentSummary,
  DocumentView,
} from '@/features/documents/document'

const IdSchema = z.object({ id: z.string().min(1) })
const RevisionSchema = IdSchema.extend({
  revision: z.number().int().nonnegative(),
})

export const listDocuments = createServerFn({ method: 'GET' })
  .middleware(PROTECTED_CHAIN)
  .handler(async ({ context }): Promise<DocumentSummary[]> => {
    const { app, actor } = await appFor(context)
    return app.documents.list(actor)
  })

export const getDocument = createServerFn({ method: 'GET' })
  .middleware(PROTECTED_CHAIN)
  .validator(IdSchema)
  .handler(async ({ context, data }): Promise<DocumentView> => {
    const { app, actor } = await appFor(context)
    return app.documents.get(actor, data.id)
  })

export const createDocument = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(
    z.object({ sourceId: z.string().min(1), name: z.string().optional() }),
  )
  .handler(async ({ context, data }): Promise<DocumentView> => {
    const { app, actor } = await appFor(context)
    return app.documents.create(actor, data.sourceId, data.name)
  })

export const renameDocument = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(IdSchema.extend({ name: z.string() }))
  .handler(async ({ context, data }): Promise<DocumentView> => {
    const { app, actor } = await appFor(context)
    return app.documents.rename(actor, data.id, data.name)
  })

/** Puts one of the person's documents at `index` in their list. */
export const moveDocument = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(IdSchema.extend({ index: z.number().int().nonnegative() }))
  .handler(async ({ context, data }): Promise<void> => {
    const { app, actor } = await appFor(context)
    await app.documents.move(actor, data.id, data.index)
  })

export const deleteDocument = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(IdSchema)
  .handler(async ({ context, data }): Promise<void> => {
    const { app, actor } = await appFor(context)
    await app.documents.delete(actor, data.id)
  })

/** Applies one change to a Document's Pipeline; `revision` is the one the editor last saw. */
export const changeDocument = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(RevisionSchema.extend({ change: DocumentChangeSchema }))
  .handler(async ({ context, data }): Promise<DocumentView> => {
    const { app, actor } = await appFor(context)
    return app.documents.change(actor, data.id, data.revision, data.change)
  })

export const undoDocument = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(RevisionSchema)
  .handler(async ({ context, data }): Promise<DocumentView> => {
    const { app, actor } = await appFor(context)
    return app.documents.undo(actor, data.id, data.revision)
  })

export const redoDocument = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(RevisionSchema)
  .handler(async ({ context, data }): Promise<DocumentView> => {
    const { app, actor } = await appFor(context)
    return app.documents.redo(actor, data.id, data.revision)
  })
