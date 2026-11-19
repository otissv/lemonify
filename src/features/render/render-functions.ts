import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { ExportSettingsSchema } from '@/features/export/export-settings'
import { RunCanvasModeSchema } from '@/features/workflows/workflow'
import { PROTECTED_CHAIN, protectedChain } from '@/server/http/chains'
import { appFor } from '@/server/http/server-fn-context'

import type { JobView } from '@/server/services/job-service'
import type { ClearedResults } from '@/server/services/render-service'

const DocumentSchema = z.object({ documentId: z.string().min(1) })

/** Queues a preview of the Document as it is now, or of the picture before a step; returns the Job to follow. */
export const requestPreview = createServerFn({ method: 'POST' })
  .middleware(protectedChain('queue'))
  .validator(
    DocumentSchema.extend({ beforeStepId: z.string().min(1).optional() }),
  )
  .handler(async ({ context, data }): Promise<JobView> => {
    const { app, actor } = await appFor(context)
    return app.renders.requestPreview(
      actor,
      data.documentId,
      data.beforeStepId === undefined
        ? {}
        : { beforeStepId: data.beforeStepId },
    )
  })

export const requestThumbnails = createServerFn({ method: 'POST' })
  .middleware(protectedChain('queue'))
  .validator(DocumentSchema.extend({ stepIds: z.array(z.string()).optional() }))
  .handler(async ({ context, data }): Promise<JobView> => {
    const { app, actor } = await appFor(context)
    return app.renders.requestThumbnails(actor, data.documentId, data.stepIds)
  })

const WorkflowThumbnailSchema = z.object({
  workflowId: z.string().min(1),
  canvasMode: RunCanvasModeSchema,
  nodeIds: z.array(z.string()).optional(),
})

/** Queues small pictures under each node of a workflow diagram. */
export const requestWorkflowThumbnails = createServerFn({ method: 'POST' })
  .middleware(protectedChain('queue'))
  .validator(WorkflowThumbnailSchema)
  .handler(async ({ context, data }): Promise<JobView> => {
    const { app, actor } = await appFor(context)
    return app.renders.requestWorkflowThumbnails(
      actor,
      data.workflowId,
      data.canvasMode,
      data.nodeIds,
    )
  })

export const requestAiStep = createServerFn({ method: 'POST' })
  .middleware(protectedChain('queue'))
  .validator(DocumentSchema.extend({ stepId: z.string().min(1) }))
  .handler(async ({ context, data }): Promise<JobView> => {
    const { app, actor } = await appFor(context)
    return app.renders.requestAiStep(actor, data.documentId, data.stepId)
  })

/** Queues a full-size export; when the Job is done its Result is downloaded from `/api/results/<id>`. */
export const requestExport = createServerFn({ method: 'POST' })
  .middleware(protectedChain('queue'))
  .validator(
    DocumentSchema.extend({
      settings: ExportSettingsSchema,
      width: z.number().int().positive().optional(),
    }),
  )
  .handler(async ({ context, data }): Promise<JobView> => {
    const { app, actor } = await appFor(context)
    return app.renders.requestExport(
      actor,
      data.documentId,
      data.settings,
      data.width,
    )
  })

export const clearUnusedResults = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(DocumentSchema)
  .handler(async ({ context, data }): Promise<ClearedResults> => {
    const { app, actor } = await appFor(context)
    return app.renders.clearUnusedResults(actor, data.documentId)
  })
