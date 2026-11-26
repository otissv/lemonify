import {
  PipelineStepKind,
  findStep,
  isContainerStep,
} from '@/features/pipeline/pipeline'
import type { Pipeline } from '@/features/pipeline/pipeline'

/** While its dialog shows: a new item being made from the one on screen or from one of its groups or embedded document layers, a workflow being copied into it, or a layer that uses another document or workflow being added to it. */
export type CreateFromRequest =
  | { kind: 'workflow-from-document'; documentId: string; stepId?: string }
  | {
      kind: 'document-from-workflow'
      workflowId: string
      stepId?: string
      /** The image for the input slot, or null for none, as a workflow layer gives; the workflow's own input image when left out. */
      inputImage?: string | null
    }
  /** A workflow being added to the document as an embedded document layer, after the selected step. */
  | { kind: 'insert-workflow'; documentId: string; afterStepId?: string }
  /** A document layer or a workflow layer being added to the document or workflow `itemId`, after the selected step. */
  | {
      kind: 'add-used-layer'
      itemId: string
      layer: UsedLayerChoice
      afterStepId?: string
    }

/** Which kind of layer that uses another item is being added. */
export type UsedLayerChoice = 'document' | 'workflow'

/** The selected step when it is a group or an embedded document layer, which a new item can start from instead of the whole pipeline. */
export function selectedContainer(
  pipeline: Pipeline,
  selectedId: string | undefined,
): { stepId?: string } {
  if (selectedId === undefined) return {}
  const found = findStep(pipeline, selectedId)
  return found !== undefined && isContainerStep(found.step)
    ? { stepId: found.step.id }
    : {}
}

/** What a create-from dialog calls its source: the group or embedded document layer it starts from, or else the document or workflow. */
export function sourceNoun(
  pipeline: Pipeline,
  stepId: string | undefined,
  whole: string,
): string {
  if (stepId === undefined) return whole
  const found = findStep(pipeline, stepId)
  if (found === undefined) return whole
  if (found.step.kind === PipelineStepKind.Group) return 'group'
  if (found.step.kind === PipelineStepKind.EmbeddedDocument) {
    return 'embedded document layer'
  }
  return whole
}

/** Where an inserted item goes: after the selected step, or at the end when none is selected. */
export function afterSelected(selectedId: string | undefined): {
  afterStepId?: string
} {
  return selectedId === undefined ? {} : { afterStepId: selectedId }
}
