import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  RunCanvasModeSchema,
  WorkflowDefinitionSchema,
  WorkflowNameSchema,
} from '@/features/workflows/workflow'
import { PROTECTED_CHAIN, protectedChain } from '@/server/http/chains'
import { appFor } from '@/server/http/server-fn-context'

import type { RunView, WorkflowView } from '@/server/services/workflow-service'

const IdSchema = z.object({ id: z.string().min(1) })

export const listWorkflows = createServerFn({ method: 'GET' })
  .middleware(PROTECTED_CHAIN)
  .handler(async ({ context }): Promise<WorkflowView[]> => {
    const { app, actor } = await appFor(context)
    return app.workflows.list(actor)
  })

export const getWorkflow = createServerFn({ method: 'GET' })
  .middleware(PROTECTED_CHAIN)
  .validator(IdSchema)
  .handler(async ({ context, data }): Promise<WorkflowView> => {
    const { app, actor } = await appFor(context)
    return app.workflows.get(actor, data.id)
  })

export const createWorkflowFn = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(z.object({ name: WorkflowNameSchema }))
  .handler(async ({ context, data }): Promise<WorkflowView> => {
    const { app, actor } = await appFor(context)
    return app.workflows.create(actor, data.name)
  })

/** Saves a workflow's name and definition; `revision` is the one the editor last saw. */
export const updateWorkflow = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(
    IdSchema.extend({
      revision: z.number().int().nonnegative(),
      name: WorkflowNameSchema,
      definition: WorkflowDefinitionSchema,
    }),
  )
  .handler(async ({ context, data }): Promise<WorkflowView> => {
    const { app, actor } = await appFor(context)
    return app.workflows.update(actor, data.id, data.revision, {
      name: data.name,
      definition: data.definition,
    })
  })

export const deleteWorkflow = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(IdSchema)
  .handler(async ({ context, data }): Promise<void> => {
    const { app, actor } = await appFor(context)
    await app.workflows.delete(actor, data.id)
  })

/** Starts a run over the input images of the workflow, on its canvas or on one the size of each image; follow it with `getWorkflowRun`. */
export const runWorkflow = createServerFn({ method: 'POST' })
  .middleware(protectedChain('queue'))
  .validator(IdSchema.extend({ canvas: RunCanvasModeSchema.optional() }))
  .handler(async ({ context, data }): Promise<RunView> => {
    const { app, actor } = await appFor(context)
    return app.workflows.run(actor, data.id, { canvas: data.canvas })
  })

export const getWorkflowRun = createServerFn({ method: 'GET' })
  .middleware(PROTECTED_CHAIN)
  .validator(IdSchema)
  .handler(async ({ context, data }): Promise<RunView> => {
    const { app, actor } = await appFor(context)
    return app.workflows.getRun(actor, data.id)
  })

export const listWorkflowRuns = createServerFn({ method: 'GET' })
  .middleware(PROTECTED_CHAIN)
  .validator(z.object({ workflowId: z.string().optional() }))
  .handler(async ({ context, data }): Promise<RunView[]> => {
    const { app, actor } = await appFor(context)
    return app.workflows.listRuns(actor, data.workflowId)
  })

export const cancelWorkflowRun = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(IdSchema)
  .handler(async ({ context, data }): Promise<RunView> => {
    const { app, actor } = await appFor(context)
    return app.workflows.cancelRun(actor, data.id)
  })

export const deleteWorkflowRun = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(IdSchema)
  .handler(async ({ context, data }): Promise<void> => {
    const { app, actor } = await appFor(context)
    await app.workflows.deleteRun(actor, data.id)
  })
