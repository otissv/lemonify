import { applyEdit } from '@/features/documents/document-sync'
import type { DocumentChange } from '@/features/pipeline/document-change'
import {
  PipelineStepKind,
  createSourceStep,
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

/** The document's own image: its first Open image step that is switched on, or the first of all. */
function ownImageIndex(steps: ReadonlyArray<PipelineStep>): number {
  const enabled = steps.findIndex(
    (step) => step.kind === PipelineStepKind.Source && step.enabled,
  )
  return enabled === -1
    ? steps.findIndex((step) => step.kind === PipelineStepKind.Source)
    : enabled
}

/** Where an inserted image goes: just before the selected step, so that step can use it, or at the end when none is selected. Never ahead of the document's own image, which the new image would then replace. */
function imageInsertIndex(
  steps: ReadonlyArray<PipelineStep>,
  selectedId: string | undefined,
): number {
  const selected = steps.findIndex(({ id }) => id === selectedId)
  if (selected === -1) return steps.length
  return Math.max(selected, ownImageIndex(steps) + 1)
}

/** Adds an Open image step for `sourceId` before the selected step (at the end when none is selected), as one undoable change, so that step and those after it can use the image. */
export function insertImage(documentId: string, sourceId: string): void {
  const steps = currentPipeline(useAppStore.getState(), documentId)?.steps
  if (!steps) return
  const selectedId = useAppStore.getState().selectedSteps[documentId]
  addStepAt(
    documentId,
    createSourceStep(sourceId),
    imageInsertIndex(steps, selectedId),
  )
}

/** The Open image step that replacing an image changes: the selected one, or else the document's own image (its first Open image step that is switched on, or the first of all). */
function replaceTarget(
  steps: ReadonlyArray<PipelineStep>,
  selectedId: string | undefined,
): string | undefined {
  const selected = steps.find(({ id }) => id === selectedId)
  if (selected?.kind === PipelineStepKind.Source) return selected.id
  const opened = steps.filter((step) => step.kind === PipelineStepKind.Source)
  return (opened.find(({ enabled }) => enabled) ?? opened[0])?.id
}

/** Makes the selected Open image step open `sourceId` instead, or the document's own image when another kind of step is selected, as one undoable change. */
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
