import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { AiToolId } from '@/features/ai/ai-tools'
import { PROTECTED_CHAIN } from '@/server/http/chains'
import { appFor } from '@/server/http/server-fn-context'

import type { AiCatalogue, AiToolSummary } from '@/features/ai/ai-tools'

/** The AI tools the server can run, for the Tools panel's AI group. */
export const listAiTools = createServerFn({ method: 'GET' })
  .middleware(PROTECTED_CHAIN)
  .handler(async ({ context }): Promise<AiToolSummary[]> => {
    const { app } = await appFor(context)
    return app.aiTools.list()
  })

/** The models of one AI tool and which one a new step starts with. */
export const getAiCatalogue = createServerFn({ method: 'GET' })
  .middleware(PROTECTED_CHAIN)
  .validator(z.object({ tool: z.enum(AiToolId) }))
  .handler(async ({ context, data }): Promise<AiCatalogue> => {
    const { app } = await appFor(context)
    return app.aiTools.get(data.tool).engine.catalogue(data.tool)
  })
