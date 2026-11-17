import { createWorkflow } from '@/features/workflows/workflow'
import type { WorkflowDefinition } from '@/features/workflows/workflow'

/** A new workflow's pipeline, inputs and output, for the views tests make up. */
export function workflowDefinition(): WorkflowDefinition {
  const { pipeline, inputs, output } = createWorkflow('Fixture')
  return { pipeline, inputs, output }
}
