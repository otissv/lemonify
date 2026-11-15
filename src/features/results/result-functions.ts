import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { PROTECTED_CHAIN } from '@/server/http/chains'
import { appFor } from '@/server/http/server-fn-context'

import type { ResultUsage, ResultView } from '@/features/results/result'

export const listResults = createServerFn({ method: 'GET' })
  .middleware(PROTECTED_CHAIN)
  .validator(
    z.object({
      documentId: z.string().optional(),
      workflowRunId: z.string().optional(),
      kind: z.enum(['ai-step', 'export', 'run-item']).optional(),
    }),
  )
  .handler(async ({ context, data }): Promise<ResultView[]> => {
    const { app, actor } = await appFor(context)
    const records = await app.results.list(actor, data)
    return records.map(
      ({ ownerId: _owner, key: _key, ...visible }): ResultView => visible,
    )
  })

export const deleteResult = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ context, data }): Promise<void> => {
    const { app, actor } = await appFor(context)
    await app.results.delete(actor, data.id)
  })

export const getResultUsage = createServerFn({ method: 'GET' })
  .middleware(PROTECTED_CHAIN)
  .handler(async ({ context }): Promise<ResultUsage> => {
    const { app, actor } = await appFor(context)
    return {
      usedBytes: await app.results.usedBytes(actor),
      maxBytes: app.config.maxResultBytesPerUser,
    }
  })
