import {
  DOCUMENT_LAYER_KIND,
  IMAGE_LAYER_KIND,
  WORKFLOW_LAYER_KIND,
  layerKind,
} from '@/features/pipeline/layer-kinds'
import type { LayerStep } from '@/features/pipeline/layer-kinds'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type {
  AiStep,
  EmbeddedDocumentStep,
  GroupMember,
  GroupStep,
  LeafStep,
  PipelineStep,
  SharpStep,
} from '@/features/pipeline/pipeline'

/** Where a copied step goes: a document, or a workflow. */
export const CopyTarget = {
  Document: 'document',
  Workflow: 'workflow',
} as const
export type CopyTarget = (typeof CopyTarget)[keyof typeof CopyTarget]

/** What the caller decides while copying a pipeline into a new document or workflow. */
export interface CopyContext {
  target: CopyTarget
  /** The image a layer keeps in the copy (for a workflow layer, the one in its input slot): its own, another, or none (undefined). */
  layerImage(layer: LayerStep): string | undefined
}

type CopyRule<Step> = (step: Step, context: CopyContext) => Step

/** How a step of one kind is copied into a document and into a workflow. Every kind is allowed in both. */
export interface StepKindDefinition<Step> {
  copy: Record<CopyTarget, CopyRule<Step>>
}

function newId<Step extends { id: string }>(step: Step): Step {
  return { ...step, id: crypto.randomUUID() }
}

function asIs<Step extends { id: string }>(): Record<
  CopyTarget,
  CopyRule<Step>
> {
  return { [CopyTarget.Document]: newId, [CopyTarget.Workflow]: newId }
}

/** A copy of a layer with a new id, drawing the image the context gives it when its kind draws one. */
function copyLayer(step: LayerStep, context: CopyContext): LayerStep {
  const { withImage } = layerKind(step)
  if (withImage === undefined) return newId(step)
  return newId(withImage(step, context.layerImage(step)))
}

/** Every kind of step that is not a container, by its `kind`. Groups and embedded document layers are copied with what they hold. */
const LAYER_COPY: StepKindDefinition<LayerStep> = {
  copy: { [CopyTarget.Document]: copyLayer, [CopyTarget.Workflow]: copyLayer },
}

/** Every kind of step that is not a container, by its `kind`. Groups and embedded document layers are copied with what they hold. A layer keeps the image the context gives it; a document layer and a workflow layer keep using what they use. */
export const STEP_KINDS: {
  [PipelineStepKind.Sharp]: StepKindDefinition<SharpStep>
  [PipelineStepKind.Ai]: StepKindDefinition<AiStep>
  [IMAGE_LAYER_KIND]: StepKindDefinition<LayerStep>
  [DOCUMENT_LAYER_KIND]: StepKindDefinition<LayerStep>
  [WORKFLOW_LAYER_KIND]: StepKindDefinition<LayerStep>
} = {
  [PipelineStepKind.Sharp]: { copy: asIs() },
  [PipelineStepKind.Ai]: { copy: asIs() },
  [IMAGE_LAYER_KIND]: LAYER_COPY,
  [DOCUMENT_LAYER_KIND]: LAYER_COPY,
  [WORKFLOW_LAYER_KIND]: LAYER_COPY,
}

function copyLeaf(step: LeafStep, context: CopyContext): LeafStep {
  const { target } = context
  switch (step.kind) {
    case PipelineStepKind.Sharp:
      return STEP_KINDS[PipelineStepKind.Sharp].copy[target](step, context)
    case PipelineStepKind.Ai:
      return STEP_KINDS[PipelineStepKind.Ai].copy[target](step, context)
    default:
      return STEP_KINDS[step.kind].copy[target](step, context)
  }
}

function copyMember(step: GroupMember, context: CopyContext): GroupMember {
  return step.kind === PipelineStepKind.Group
    ? copyGroup(step, context)
    : copyLeaf(step, context)
}

function copyGroup(group: GroupStep, context: CopyContext): GroupStep {
  const steps: GroupMember[] = []
  for (const member of group.steps) steps.push(copyMember(member, context))
  return { ...newId(group), steps }
}

function copyEmbedded(
  embedded: EmbeddedDocumentStep,
  context: CopyContext,
): EmbeddedDocumentStep {
  return { ...newId(embedded), steps: copyStepsInto(embedded.steps, context) }
}

/** The step copied by its kind's rule under a new id; a container is copied with everything in it. */
export function copyStepInto(
  step: PipelineStep,
  context: CopyContext,
): PipelineStep {
  if (step.kind === PipelineStepKind.Group) return copyGroup(step, context)
  if (step.kind === PipelineStepKind.EmbeddedDocument) {
    return copyEmbedded(step, context)
  }
  return copyLeaf(step, context)
}

/** The steps, in order, each copied by its kind's rule into the target. */
export function copyStepsInto(
  steps: ReadonlyArray<PipelineStep>,
  context: CopyContext,
): PipelineStep[] {
  const copied: PipelineStep[] = []
  for (const step of steps) copied.push(copyStepInto(step, context))
  return copied
}
