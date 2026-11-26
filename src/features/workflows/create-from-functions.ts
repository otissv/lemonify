import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import type { DocumentView } from '@/features/documents/document'
import { pictureSizeSchema } from '@/features/pipeline/canvas'
import { ImageChoiceSchema } from '@/features/workflows/create-from'
import { WorkflowNameSchema } from '@/features/workflows/workflow'
import { PROTECTED_CHAIN } from '@/server/http/chains'
import { appFor } from '@/server/http/server-fn-context'
import type { EmbeddedDocumentStep } from '@/features/pipeline/pipeline'
import type { WorkflowView } from '@/server/services/workflow-service'

const id = z.string().min(1)

/** Makes a workflow from a document, or from one of its groups or embedded document layers. */
export const createWorkflowFromDocumentFn = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(
    z.object({
      documentId: id,
      stepId: id.optional(),
      images: ImageChoiceSchema,
      name: WorkflowNameSchema,
    }),
  )
  .handler(async ({ context, data }): Promise<WorkflowView> => {
    const { app, actor } = await appFor(context)
    const { documentId, ...options } = data
    return app.createFrom.workflowFromDocument(actor, documentId, options)
  })

/** Makes a document from a workflow, or from one of its groups or embedded document layers. */
export const createDocumentFromWorkflowFn = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(
    z.object({
      workflowId: id,
      stepId: id.optional(),
      inputImage: id.nullable().optional(),
      size: pictureSizeSchema.optional(),
      name: z.string().trim().min(1, 'Enter a name.'),
    }),
  )
  .handler(async ({ context, data }): Promise<DocumentView> => {
    const { app, actor } = await appFor(context)
    const { workflowId, ...options } = data
    return app.createFrom.documentFromWorkflow(actor, workflowId, options)
  })

/** The embedded document layer a document layer or workflow layer becomes when converted, for the editor to put in its place as one undoable change. */
export const layerAsEmbeddedFn = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(
    z.object({
      holder: z.object({ kind: z.enum(['document', 'workflow']), id }),
      stepId: id,
    }),
  )
  .handler(async ({ context, data }): Promise<EmbeddedDocumentStep> => {
    const { app, actor } = await appFor(context)
    return app.createFrom.layerAsEmbedded(actor, data.holder, data.stepId)
  })

/** A workflow as the embedded document layer it becomes in a document, for the editor to add as one undoable change. */
export const workflowAsEmbeddedFn = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(z.object({ workflowId: id, sourceId: id.optional() }))
  .handler(async ({ context, data }): Promise<EmbeddedDocumentStep> => {
    const { app, actor } = await appFor(context)
    return app.createFrom.workflowAsEmbedded(
      actor,
      data.workflowId,
      data.sourceId,
    )
  })
