import { createWorkflow } from '@/features/workflows/workflow'
import type { WorkflowDefinition } from '@/features/workflows/workflow'
import type { WorkflowView } from '@/server/services/workflow-service'

/** A new workflow's pipeline, inputs and output, for the views tests make up. */
export function workflowDefinition(): WorkflowDefinition {
  const { pipeline, inputs, output, canvasSize } = createWorkflow('Fixture')
  return { pipeline, inputs, output, canvasSize }
}

/** A workflow as the server sends it, with the pipeline, inputs and output of a new one. */
export function workflowView(id = 'w1', name = 'Fixture'): WorkflowView {
  return {
    id,
    name,
    ...workflowDefinition(),
    revision: 0,
    canUndo: false,
    canRedo: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
