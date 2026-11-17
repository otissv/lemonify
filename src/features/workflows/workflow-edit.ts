import type { DocumentChange } from '@/features/pipeline/document-change'
import { PipelineStepKind, findStep } from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import type { WorkflowDefinition } from '@/features/workflows/workflow'
import type { WorkflowChange } from '@/features/workflows/workflow-change'

type Shown = Pick<WorkflowDefinition, 'pipeline' | 'inputs'>

/**
 * The change that adds `step` after the step with id `afterId`, in the same
 * group when that step is in one; into the group when `afterId` is a group (at
 * its end); at the end of the pipeline when nothing is selected. A group always
 * goes at the top. The change is made on the workflow's Edit history like any
 * other, so it can be undone.
 */
export function addStepChange(
  workflow: Shown,
  step: PipelineStep,
  afterId: string | null,
): DocumentChange {
  const { pipeline } = workflow
  const found = afterId === null ? undefined : findStep(pipeline, afterId)
  if (found === undefined) {
    return { type: 'add-step', step, index: pipeline.steps.length }
  }
  if (found.step.kind === PipelineStepKind.Group) {
    if (step.kind === PipelineStepKind.Group) {
      return { type: 'add-step', step, index: found.index + 1 }
    }
    return {
      type: 'add-step',
      step,
      index: found.step.steps.length,
      groupId: found.step.id,
    }
  }
  if (found.groupId === undefined || step.kind === PipelineStepKind.Group) {
    const top = pipeline.steps.findIndex(
      ({ id }) => id === (found.groupId ?? found.step.id),
    )
    return { type: 'add-step', step, index: top + 1 }
  }
  return {
    type: 'add-step',
    step,
    index: found.index + 1,
    groupId: found.groupId,
  }
}

function groupSteps(workflow: Shown, groupId: string): PipelineStep[] {
  for (const step of workflow.pipeline.steps) {
    if (step.kind === PipelineStepKind.Group && step.id === groupId) {
      return step.steps
    }
  }
  return []
}

/** The change that moves a step one place later (1) or earlier (-1) in its own list; nothing when it is already at that end or is not there. */
export function moveStepChange(
  workflow: Shown,
  stepId: string,
  delta: -1 | 1,
): DocumentChange | undefined {
  const found = findStep(workflow.pipeline, stepId)
  if (found === undefined) return undefined
  const siblings =
    found.groupId === undefined
      ? workflow.pipeline.steps
      : groupSteps(workflow, found.groupId)
  const to = found.index + delta
  if (to < 0 || to >= siblings.length) return undefined
  return {
    type: 'move-step',
    stepId,
    to,
    ...(found.groupId === undefined ? {} : { groupId: found.groupId }),
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
