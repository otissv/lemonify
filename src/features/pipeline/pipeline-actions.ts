import { applyEdit, loadDocument } from '@/features/documents/document-sync'
import type { DocumentChange } from '@/features/pipeline/document-change'
import type { LayerSettings } from '@/features/pipeline/layer'
import { supportsBlend } from '@/features/pipeline/step-blend'
import type { StepBlend } from '@/features/pipeline/step-blend'
import {
  PipelineStepKind,
  canvasLayer,
  copyStep,
  createGroupStep,
  createLayerStep,
  findStep,
  groupableSteps,
  leafSteps,
} from '@/features/pipeline/pipeline'
import type {
  AiStep,
  Pipeline,
  PipelineStep,
  SharpStep,
} from '@/features/pipeline/pipeline'
import { Tool, currentPipeline, useAppStore } from '@/store/app-store'
import type { AiContent } from '@/features/ai/ai-tools'
import { errorMessage } from '@/lib/error-message'

const OPEN_FAILED = 'That image could not be opened.'
export const GROUPING_NEEDS_STEPS =
  'Pick steps that are next to each other and not in a group.'

type SharpOptions = SharpStep['options']

function addStepAt(
  documentId: string,
  step: PipelineStep,
  index: number,
  groupId?: string,
): void {
  void applyEdit(documentId, {
    type: 'add-step',
    step,
    index,
    ...(groupId === undefined ? {} : { groupId }),
  })
  const store = useAppStore.getState()
  store.selectStep(documentId, step.id)
  store.setDocumentExpanded(documentId, true)
  store.setActiveTool(Tool.Options)
}

/** Adds a step after `afterId` (at the end by default), selects it and shows its options, as one undoable change. After a step in a group it goes in that group; after a group, after the whole group. A group cannot be added inside a group. */
export function addStepAfter(
  documentId: string,
  step: PipelineStep,
  afterId?: string,
): void {
  const pipeline = currentPipeline(useAppStore.getState(), documentId)
  if (!pipeline) return
  const after = afterId === undefined ? undefined : findStep(pipeline, afterId)
  const groupId =
    step.kind === PipelineStepKind.Group ? undefined : after?.groupId
  const siblings =
    groupId === undefined
      ? pipeline.steps
      : (findGroup(pipeline.steps, groupId)?.steps ?? [])
  const index = after === undefined ? siblings.length : after.index + 1
  addStepAt(documentId, step, index, groupId)
}

function findGroup(
  steps: ReadonlyArray<PipelineStep>,
  groupId: string,
): Extract<PipelineStep, { kind: typeof PipelineStepKind.Group }> | undefined {
  for (const step of steps) {
    if (step.kind === PipelineStepKind.Group && step.id === groupId) return step
  }
  return undefined
}

export function deleteStep(documentId: string, stepId: string): void {
  void applyEdit(documentId, { type: 'remove-step', stepId })
  const store = useAppStore.getState()
  if (store.selectedSteps[documentId] === stepId) {
    store.selectStep(documentId, undefined)
  }
}

/** Moves a step to `index` in the order the steps have once it is taken out, at the top level or, with `groupId`, inside that group. */
export function reorderStep(
  documentId: string,
  stepId: string,
  index: number,
  groupId?: string,
): void {
  void applyEdit(documentId, {
    type: 'move-step',
    stepId,
    to: index,
    ...(groupId === undefined ? {} : { groupId }),
  })
}

/** Puts the steps in a new group, as one undoable change, and selects the group. The steps must be next to each other at the top level; returns why they cannot be grouped, or nothing when the change was made. */
export function groupSteps(
  documentId: string,
  stepIds: ReadonlyArray<string>,
): string | undefined {
  const pipeline = currentPipeline(useAppStore.getState(), documentId)
  if (!pipeline) return undefined
  const members = groupableSteps(pipeline, stepIds)
  if (members === undefined) return GROUPING_NEEDS_STEPS
  const group = createGroupStep(members)
  void applyEdit(documentId, { type: 'group-steps', group })
  const store = useAppStore.getState()
  store.selectStep(documentId, group.id)
  store.setDocumentExpanded(documentId, true)
  return undefined
}

/** Takes the steps out of a group, leaving them where it was, as one undoable change. */
export function ungroupSteps(documentId: string, groupId: string): void {
  void applyEdit(documentId, { type: 'ungroup', groupId })
  const store = useAppStore.getState()
  if (store.selectedSteps[documentId] === groupId) {
    store.selectStep(documentId, undefined)
  }
}

export function setStepOn(
  documentId: string,
  stepId: string,
  enabled: boolean,
): void {
  void applyEdit(documentId, { type: 'set-enabled', stepId, enabled })
}

function stepOf(documentId: string, stepId: string): PipelineStep | undefined {
  const pipeline = currentPipeline(useAppStore.getState(), documentId)
  return pipeline ? findStep(pipeline, stepId)?.step : undefined
}

/**
 * Puts a copy of a step on top of another document's steps, as one undoable
 * change to that document; the step stays where it was. The copy has an id of
 * its own. Returns why it could not be done, or nothing when it was.
 */
export async function copyStepToDocument(
  fromId: string,
  stepId: string,
  toId: string,
): Promise<string | undefined> {
  if (fromId === toId) return undefined
  const step = stepOf(fromId, stepId)
  if (!step) return undefined
  try {
    await loadDocument(toId)
  } catch (caught) {
    return errorMessage(caught, OPEN_FAILED)
  }
  const store = useAppStore.getState()
  const steps = currentPipeline(store, toId)?.steps
  if (!steps) return undefined
  store.clearDocumentError(toId)
  store.setDocumentExpanded(toId, true)
  await applyEdit(toId, {
    type: 'add-step',
    step: copyStep(step),
    index: steps.length,
  })
  return useAppStore.getState().documents[toId]?.error
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
  pipeline: Pipeline,
  selectedId: string | undefined,
): string | undefined {
  const selected =
    selectedId === undefined ? undefined : findStep(pipeline, selectedId)?.step
  if (selected?.kind === PipelineStepKind.Layer) return selected.id
  const canvas = canvasLayer(pipeline)
  return (
    canvas ??
    leafSteps(pipeline).find((step) => step.kind === PipelineStepKind.Layer)
  )?.id
}

/** Makes the selected layer use `sourceId` instead, or the layer that sets the canvas when another kind of step is selected, as one undoable change. */
export function replaceImage(documentId: string, sourceId: string): void {
  const pipeline = currentPipeline(useAppStore.getState(), documentId)
  if (!pipeline) return
  const stepId = replaceTarget(
    pipeline,
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

/** Sets how the result of a filter or colour step is blended with the picture before it (the defaults take the blend away), as one undoable change; nothing if the step is gone or cannot have one. */
export function setStepBlend(
  documentId: string,
  stepId: string,
  blend: StepBlend,
): void {
  const step = stepOf(documentId, stepId)
  if (step?.kind !== PipelineStepKind.Sharp || !supportsBlend(step.op)) return
  void applyEdit(documentId, { type: 'set-blend', stepId, blend })
}

/** Sets how a layer, or a group that is a sub-document, is drawn on the picture, as one undoable change; nothing if the step is gone or is neither. */
export function setLayerSettings(
  documentId: string,
  stepId: string,
  settings: LayerSettings,
): void {
  const kind = stepOf(documentId, stepId)?.kind
  if (kind !== PipelineStepKind.Layer && kind !== PipelineStepKind.Group) return
  void applyEdit(documentId, { type: 'set-layer', stepId, settings })
}

/** Makes a group a picture of its own, or a plain group again, as one undoable change; nothing if the step is gone or is not a group. */
export function setSubDocument(
  documentId: string,
  stepId: string,
  subDocument: boolean,
): void {
  if (stepOf(documentId, stepId)?.kind !== PipelineStepKind.Group) return
  void applyEdit(documentId, { type: 'set-sub-document', stepId, subDocument })
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
