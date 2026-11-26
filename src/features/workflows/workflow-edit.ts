import type { DocumentChange } from '@/features/pipeline/document-change'
import { childSteps, findStep, placeAfter } from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import type { WorkflowDefinition } from '@/features/workflows/workflow'
import type { WorkflowChange } from '@/features/workflows/workflow-change'

type Shown = Pick<WorkflowDefinition, 'pipeline' | 'inputs'>

/**
 * The change that adds `step` after the step with id `afterId`, in the same
 * list; into a group or an embedded document layer when `afterId` is one (at
 * its end); at the end of the pipeline when nothing is selected. Where the
 * list cannot hold the step it goes after the nearest container that can. The
 * change is made on the workflow's Edit history like any other, so it can be
 * undone.
 */
export function addStepChange(
  workflow: Shown,
  step: PipelineStep,
  afterId: string | null,
): DocumentChange {
  const { index, parentId } = placeAfter(
    workflow.pipeline,
    step,
    afterId ?? undefined,
    { into: true },
  )
  return {
    type: 'add-step',
    step,
    index,
    ...(parentId === undefined ? {} : { parentId }),
  }
}

/** The change that moves a step one place later (1) or earlier (-1) in its own list; nothing when it is already at that end or is not there. */
export function moveStepChange(
  workflow: Shown,
  stepId: string,
  delta: -1 | 1,
): DocumentChange | undefined {
  const found = findStep(workflow.pipeline, stepId)
  if (found === undefined) return undefined
  const siblings = childSteps(workflow.pipeline, found.parentId) ?? []
  const to = found.index + delta
  if (to < 0 || to >= siblings.length) return undefined
  return {
    type: 'move-step',
    stepId,
    to,
    ...(found.parentId === undefined ? {} : { parentId: found.parentId }),
  }
}

/** The change that adds input images, each once; nothing when all are there already. */
export function addInputsChange(
  workflow: Shown,
  sourceIds: ReadonlyArray<string>,
): WorkflowChange | undefined {
  const inputs = [...new Set([...workflow.inputs, ...sourceIds])]
  if (inputs.length === workflow.inputs.length) return undefined
  return { type: 'set-inputs', sourceIds: inputs }
}

/** The change that takes an input image out; nothing when it is not one. */
export function removeInputChange(
  workflow: Shown,
  sourceId: string,
): WorkflowChange | undefined {
  if (!workflow.inputs.includes(sourceId)) return undefined
  return {
    type: 'set-inputs',
    sourceIds: workflow.inputs.filter((id) => id !== sourceId),
  }
}
