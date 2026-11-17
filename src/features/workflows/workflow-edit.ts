import { planChange } from '@/features/pipeline/document-change'
import type { DocumentChange } from '@/features/pipeline/document-change'
import { PipelineStepKind, findStep } from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import type { OutputSettings } from '@/features/workflows/output-settings'
import type { Workflow } from '@/features/workflows/workflow'

/**
 * The workflow with one document change applied to its pipeline: a workflow is
 * edited with the same changes as a document, so a step, a layer, a group or the
 * canvas behaves the same in both. The same workflow comes back when the change
 * leaves the pipeline as it was.
 */
export function changePipeline(
  workflow: Workflow,
  change: DocumentChange,
): Workflow {
  const planned = planChange(workflow.pipeline, change)
  if (planned === null) return workflow
  return { ...workflow, pipeline: planned.pipeline }
}

/**
 * Adds `step` after the step with id `afterId`, in the same group when that
 * step is in one; into the group when `afterId` is a group (at its end); at the
 * end of the pipeline when nothing is selected. A group always goes at the top.
 */
export function addStepAfter(
  workflow: Workflow,
  step: PipelineStep,
  afterId: string | null,
): Workflow {
  const { pipeline } = workflow
  const found = afterId === null ? undefined : findStep(pipeline, afterId)
  if (found === undefined) {
    return changePipeline(workflow, {
      type: 'add-step',
      step,
      index: pipeline.steps.length,
    })
  }
  if (found.step.kind === PipelineStepKind.Group) {
    if (step.kind === PipelineStepKind.Group) {
      return changePipeline(workflow, {
        type: 'add-step',
        step,
        index: found.index + 1,
      })
    }
    return changePipeline(workflow, {
      type: 'add-step',
      step,
      index: found.step.steps.length,
      groupId: found.step.id,
    })
  }
  if (found.groupId === undefined || step.kind === PipelineStepKind.Group) {
    const top = pipeline.steps.findIndex(
      ({ id }) => id === (found.groupId ?? found.step.id),
    )
    return changePipeline(workflow, {
      type: 'add-step',
      step,
      index: top + 1,
    })
  }
  return changePipeline(workflow, {
    type: 'add-step',
    step,
    index: found.index + 1,
    groupId: found.groupId,
  })
}

/** Moves a step one place later (1) or earlier (-1) in its own list; the same workflow when it is already at that end or is not there. */
export function moveStepBy(
  workflow: Workflow,
  stepId: string,
  delta: -1 | 1,
): Workflow {
  const found = findStep(workflow.pipeline, stepId)
  if (found === undefined) return workflow
  const siblings =
    found.groupId === undefined
      ? workflow.pipeline.steps
      : groupSteps(workflow, found.groupId)
  const to = found.index + delta
  if (to < 0 || to >= siblings.length) return workflow
  return changePipeline(workflow, {
    type: 'move-step',
    stepId,
    to,
    ...(found.groupId === undefined ? {} : { groupId: found.groupId }),
  })
}

function groupSteps(workflow: Workflow, groupId: string): PipelineStep[] {
  for (const step of workflow.pipeline.steps) {
    if (step.kind === PipelineStepKind.Group && step.id === groupId) {
      return step.steps
    }
  }
  return []
}

/** Adds input images, each once; the same workflow when all are there already. */
export function addInputs(
  workflow: Workflow,
  sourceIds: ReadonlyArray<string>,
): Workflow {
  const inputs = [...new Set([...workflow.inputs, ...sourceIds])]
  if (inputs.length === workflow.inputs.length) return workflow
  return { ...workflow, inputs }
}

export function removeInput(workflow: Workflow, sourceId: string): Workflow {
  if (!workflow.inputs.includes(sourceId)) return workflow
  return {
    ...workflow,
    inputs: workflow.inputs.filter((id) => id !== sourceId),
  }
}

export function withOutput(
  workflow: Workflow,
  output: OutputSettings,
): Workflow {
  return { ...workflow, output }
}
