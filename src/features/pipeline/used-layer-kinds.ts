import { z } from 'zod'

import { layerSettingsSchema } from '@/features/pipeline/layer'
import { DEFAULT_LAYER_SETTINGS } from '@/features/pipeline/layer'
import { mappedId } from '@/features/pipeline/layer-kind-types'
import type { LayerKindDefinition } from '@/features/pipeline/layer-kind-types'
import {
  stepEnabledSchema,
  stepNameSchema,
} from '@/features/pipeline/step-common'

/** The kind of layer that draws another of the User's documents, as it is now, at its own canvas size. */
export const DOCUMENT_LAYER_KIND = 'document-layer'
/** The kind of layer that draws one of the User's workflows, as it is now, on the layer's own image. */
export const WORKFLOW_LAYER_KIND = 'workflow-layer'

export const documentLayerStepSchema = z.strictObject({
  id: z.uuid(),
  kind: z.literal(DOCUMENT_LAYER_KIND),
  documentId: z.string().min(1),
  enabled: stepEnabledSchema,
  name: stepNameSchema,
  ...layerSettingsSchema.shape,
})

export const workflowLayerStepSchema = z.strictObject({
  id: z.uuid(),
  kind: z.literal(WORKFLOW_LAYER_KIND),
  workflowId: z.string().min(1),
  /** The image for the workflow's input slot; with none the workflow draws without an input. */
  sourceId: z.string().min(1).optional(),
  enabled: stepEnabledSchema,
  name: stepNameSchema,
  ...layerSettingsSchema.shape,
})

export type DocumentLayerStep = z.output<typeof documentLayerStepSchema>
export type WorkflowLayerStep = z.output<typeof workflowLayerStepSchema>

const DOCUMENT_GONE = 'Document not available'
const WORKFLOW_GONE = 'Workflow not available'
const NO_INPUT = 'no input image'
const IMAGE_GONE = 'image not available'

export function createDocumentLayerStep(documentId: string): DocumentLayerStep {
  return {
    id: crypto.randomUUID(),
    kind: DOCUMENT_LAYER_KIND,
    documentId,
    enabled: true,
    ...DEFAULT_LAYER_SETTINGS,
  }
}

export function createWorkflowLayerStep(
  workflowId: string,
  sourceId?: string,
): WorkflowLayerStep {
  return {
    id: crypto.randomUUID(),
    kind: WORKFLOW_LAYER_KIND,
    workflowId,
    ...(sourceId === undefined ? {} : { sourceId }),
    enabled: true,
    ...DEFAULT_LAYER_SETTINGS,
  }
}

export const documentLayerKind: LayerKindDefinition<DocumentLayerStep> = {
  title: 'Document layer',
  sourceIds: () => [],
  withSourceIds: (step) => step,
  uses: (step) => ({ kind: 'document', documentId: step.documentId }),
  withUsedIds: (step, ids) => ({
    ...step,
    documentId: mappedId(step.documentId, ids),
  }),
  problem: () => undefined,
  display(step, names) {
    const name = names.document(step.documentId)
    return name === undefined
      ? { text: DOCUMENT_GONE, problem: true }
      : { text: name, problem: false }
  },
  plan: async (step) => ({
    state: 'used',
    item: { kind: 'document', documentId: step.documentId },
  }),
}

export const workflowLayerKind: LayerKindDefinition<WorkflowLayerStep> = {
  title: 'Workflow layer',
  sourceIds: (step) => (step.sourceId === undefined ? [] : [step.sourceId]),
  withSourceIds: (step, ids) =>
    step.sourceId === undefined
      ? step
      : { ...step, sourceId: mappedId(step.sourceId, ids) },
  withImage: ({ sourceId: _previous, ...rest }, sourceId) =>
    sourceId === undefined ? rest : { ...rest, sourceId },
  uses: (step) => ({
    kind: 'workflow',
    workflowId: step.workflowId,
    ...(step.sourceId === undefined ? {} : { sourceId: step.sourceId }),
  }),
  withUsedIds: (step, ids) => ({
    ...step,
    workflowId: mappedId(step.workflowId, ids),
  }),
  problem: () => undefined,
  display(step, names) {
    const workflow = names.workflow(step.workflowId)
    if (workflow === undefined) return { text: WORKFLOW_GONE, problem: true }
    if (step.sourceId === undefined) {
      return { text: `${workflow} · ${NO_INPUT}`, problem: false }
    }
    const image = names.image(step.sourceId)
    return image === undefined
      ? { text: `${workflow} · ${IMAGE_GONE}`, problem: true }
      : { text: `${workflow} · ${image}`, problem: false }
  },
  async plan(step, lookup) {
    if (
      step.sourceId !== undefined &&
      (await lookup(step.sourceId)) === undefined
    ) {
      return { state: 'gone' }
    }
    return {
      state: 'used',
      item: {
        kind: 'workflow',
        workflowId: step.workflowId,
        ...(step.sourceId === undefined ? {} : { sourceId: step.sourceId }),
      },
    }
  },
}
