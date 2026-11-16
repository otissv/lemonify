import { applyEdit } from '@/features/documents/document-sync'
import type { DocumentChange } from '@/features/pipeline/document-change'
import type { LayerSettings } from '@/features/pipeline/layer'
import {
  PipelineStepKind,
  canvasLayer,
  createLayerStep,
} from '@/features/pipeline/pipeline'
import type {
  AiStep,
  PipelineStep,
  SharpStep,
} from '@/features/pipeline/pipeline'
import { Tool, currentPipeline, useAppStore } from '@/store/app-store'
import type { AiContent } from '@/features/ai/ai-tools'

type SharpOptions = SharpStep['options']

function addStepAt(
  documentId: string,
  step: PipelineStep,
  index: number,
): void {
  void applyEdit(documentId, { type: 'add-step', step, index })
  const store = useAppStore.getState()
  store.selectStep(documentId, step.id)
  store.setDocumentExpanded(documentId, true)
  store.setActiveTool(Tool.Options)
}

/** Adds a step after `afterId` (at the end by default), selects it and shows its options, as one undoable change. */
export function addStepAfter(
  documentId: string,
  step: PipelineStep,
  afterId?: string,
): void {
  const steps = currentPipeline(useAppStore.getState(), documentId)?.steps
  if (!steps) return
  const after = steps.findIndex(({ id }) => id === afterId)
  addStepAt(documentId, step, after === -1 ? steps.length : after + 1)
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

/** Adds a layer for `sourceId` just after the selected step, on top of it (on top of everything when none is selected), as one undoable change. */
export function insertImage(documentId: string, sourceId: string): void {
  addStepAfter(
    documentId,
    createLayerStep(sourceId),
    useAppStore.getState().selectedSteps[documentId],
  )
}

/** The step that replacing an image changes: the selected layer, or else the layer that sets the canvas, or the first layer when all are off. */
function replaceTarget(
  steps: ReadonlyArray<PipelineStep>,
  selectedId: string | undefined,
): string | undefined {
  const selected = steps.find(({ id }) => id === selectedId)
  if (selected?.kind === PipelineStepKind.Layer) return selected.id
  const canvas = canvasLayer({ steps })
  return (canvas ?? steps.find((step) => step.kind === PipelineStepKind.Layer))
    ?.id
}

/** Makes the selected layer use `sourceId` instead, or the layer that sets the canvas when another kind of step is selected, as one undoable change. */
export function replaceImage(documentId: string, sourceId: string): void {
  const steps = currentPipeline(useAppStore.getState(), documentId)?.steps
  if (!steps) return
  const stepId = replaceTarget(
    steps,
    useAppStore.getState().selectedSteps[documentId],
  )
  if (stepId !== undefined) setStepSource(documentId, stepId, sourceId)
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

/** Makes a layer use another image, as one undoable change; nothing if the step is gone. */
export function setStepSource(
  documentId: string,
  stepId: string,
  sourceId: string,
): void {
  if (stepOf(documentId, stepId)?.kind !== PipelineStepKind.Layer) return
  void applyEdit(documentId, { type: 'set-source', stepId, sourceId })
}

/** Gives a step a name, or with an empty one takes it away, as one undoable change; nothing if the step is gone. */
export function renameStep(
  documentId: string,
  stepId: string,
  name: string,
): void {
  if (stepOf(documentId, stepId) === undefined) return
  void applyEdit(documentId, { type: 'rename-step', stepId, name })
}

/** Sets how a layer is drawn, as one undoable change; nothing if the step is gone or is not a layer. */
export function setLayerSettings(
  documentId: string,
  stepId: string,
  settings: LayerSettings,
): void {
  if (stepOf(documentId, stepId)?.kind !== PipelineStepKind.Layer) return
  void applyEdit(documentId, { type: 'set-layer', stepId, settings })
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
