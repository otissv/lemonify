import { applyEdit } from '@/features/documents/document-sync'
import type { DocumentChange } from '@/features/pipeline/document-change'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type {
  AiStep,
  PipelineStep,
  SharpStep,
} from '@/features/pipeline/pipeline'
import { Tool, currentPipeline, useAppStore } from '@/store/app-store'
import type { AiContent } from '@/features/ai/ai-tools'

type SharpOptions = SharpStep['options']

/** Adds a step after `afterId` (at the end by default), selects it and shows its options, as one undoable change. */
export function addStepAfter(
  documentId: string,
  step: PipelineStep,
  afterId?: string,
): void {
  const steps = currentPipeline(useAppStore.getState(), documentId)?.steps
  if (!steps) return
  const after = steps.findIndex(({ id }) => id === afterId)
  const index = after === -1 ? steps.length : after + 1
  void applyEdit(documentId, { type: 'add-step', step, index })
  const store = useAppStore.getState()
  store.selectStep(documentId, step.id)
  store.setDocumentExpanded(documentId, true)
  store.setActiveTool(Tool.Options)
}

export function deleteStep(documentId: string, stepId: string): void {
  void applyEdit(documentId, { type: 'remove-step', stepId })
  const store = useAppStore.getState()
  if (store.selectedSteps[documentId] === stepId) {
    store.selectStep(documentId, undefined)
  }
}

/** Moves a step to `index` in the order the steps have once it is taken out. */
export function reorderStep(
  documentId: string,
  stepId: string,
  index: number,
): void {
  void applyEdit(documentId, { type: 'move-step', stepId, to: index })
}

export function setStepOn(
  documentId: string,
  stepId: string,
  enabled: boolean,
): void {
  void applyEdit(documentId, { type: 'set-enabled', stepId, enabled })
}

function stepOf(documentId: string, stepId: string): PipelineStep | undefined {
  return currentPipeline(useAppStore.getState(), documentId)?.steps.find(
    ({ id }) => id === stepId,
  )
}

/** Sets the options of a Sharp step, as one undoable change; nothing if the step is gone. */
export function setSharpOptions(
  documentId: string,
  stepId: string,
  options: SharpOptions,
): void {
  if (stepOf(documentId, stepId)?.kind !== PipelineStepKind.Sharp) return
  void applyEdit(documentId, { type: 'set-options', stepId, options })
}

/** Makes an Open image step open another image, as one undoable change; nothing if the step is gone. */
export function setStepSource(
  documentId: string,
  stepId: string,
  sourceId: string,
): void {
  if (stepOf(documentId, stepId)?.kind !== PipelineStepKind.Source) return
  void applyEdit(documentId, { type: 'set-source', stepId, sourceId })
}

/** Sets the settings of an AI step, as one undoable change; nothing if the step is gone. */
export function setAiSettings(
  documentId: string,
  stepId: string,
  content: AiContent<AiStep>,
): void {
  if (stepOf(documentId, stepId)?.kind !== PipelineStepKind.Ai) return
  const change: DocumentChange = { type: 'set-settings', stepId, ...content }
  void applyEdit(documentId, change)
}
