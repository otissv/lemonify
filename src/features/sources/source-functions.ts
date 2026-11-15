import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { PROTECTED_CHAIN } from '@/server/http/chains'
import { appFor } from '@/server/http/server-fn-context'
import { toSourceSummary } from '@/server/services/source-service'

import type { SourceSummary } from '@/features/documents/document'

/** The User's uploaded images, newest first. */
export const listSources = createServerFn({ method: 'GET' })
  .middleware(PROTECTED_CHAIN)
  .handler(async ({ context }): Promise<SourceSummary[]> => {
    const { app, actor } = await appFor(context)
    return (await app.sources.list(actor)).map(toSourceSummary)
  })

/** Deletes an image that no Document and no step uses. */
export const deleteSource = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ context, data }): Promise<void> => {
    const { app, actor } = await appFor(context)
    await app.sources.delete(actor, data.id)
  })
