import type { AiCatalogues } from '@/features/ai/ai-defaults'
import type { ImageOpener } from '@/features/app/image-opener'
import { canRedoNow, canUndoNow } from '@/features/pipeline/pipeline-session'
import { redoEdit, undoEdit } from '@/features/pipeline/pipeline-sync'
import { Page, actionById } from '@/features/keybindings/actions'
import {
  PipelineStepKind,
  groupableSteps,
  hasEdits,
  leafSteps,
} from '@/features/pipeline/pipeline'
import type { Pipeline, PipelineStep } from '@/features/pipeline/pipeline'
import {
  addEmptyImageLayer,
  deleteStep,
  groupSteps,
  reorderStep,
  setStepOn,
  ungroupSteps,
} from '@/features/pipeline/pipeline-actions'
import { isLayerStep } from '@/features/pipeline/layer-kinds'
import { addTool } from '@/features/tools/add-tool'
import { PAN_STEPS, panDistance } from '@/features/viewport/pan-step'
import { viewportActionsFor } from '@/features/viewport/use-viewport'
import { CANVAS_SELECTION } from '@/features/workflows/workflow-selection'
import { SidePanelTab, Tool, useUiStore } from '@/store/ui-store'
import {
  currentPipeline,
  documentSession,
  usePipelineStore,
} from '@/store/pipeline-store'

/** What an action needs from the page it runs on. */
export interface ActionContext {
  /** The kind of page, which decides the actions that apply on it. */
  page: Page
  /** The document on screen; none on pages without one. */
  documentId: string | undefined
  /** What the AI tools offer; known on a document's page. Actions that add an AI tool need it. */
  catalogues: AiCatalogues | undefined
  opener: ImageOpener
  /** Closes the document and moves to the one before it, or home. */
  closeDocument: (documentId: string) => void
}

const PANELS: Readonly<Record<string, Tool>> = {
  'panel.tools': Tool.Tools,
  'panel.options': Tool.Options,
  'panel.export': Tool.Export,
  'panel.results': Tool.Results,
  'panel.document': Tool.Document,
  'panel.navigator': Tool.Navigator,
}

type Snapshot = {
  documentId: string
  hasSession: boolean
  pipeline: Pipeline | undefined
  selectedId: string | undefined
  marked: ReadonlyArray<string>
}

function snapshot(documentId: string): Snapshot {
  const pipelines = usePipelineStore.getState()
  const ui = useUiStore.getState()
  return {
    documentId,
    hasSession: pipelines.sessions[documentId] !== undefined,
    pipeline: currentPipeline(pipelines, documentId),
    selectedId: ui.selectedSteps[documentId],
    marked: ui.markedSteps[documentId] ?? [],
  }
}

type Place = {
  step: PipelineStep
  siblings: ReadonlyArray<PipelineStep>
  index: number
  groupId?: string
}

function placeOf(
  pipeline: Pipeline | undefined,
  id: string | undefined,
): Place | undefined {
  if (pipeline === undefined || id === undefined) return undefined
  for (const [index, step] of pipeline.steps.entries()) {
    if (step.id === id) return { step, siblings: pipeline.steps, index }
    if (step.kind !== PipelineStepKind.Group) continue
    const inner = step.steps.findIndex((leaf) => leaf.id === id)
    const leaf = step.steps[inner]
    if (leaf !== undefined) {
      return {
        step: leaf,
        siblings: step.steps,
        index: inner,
        groupId: step.id,
      }
    }
  }
  return undefined
}

/** Every step in the order the sidebar lists them: each group, then the steps in it. */
function listedStepIds(pipeline: Pipeline): string[] {
  const ids: string[] = []
  for (const step of pipeline.steps) {
    ids.push(step.id)
    if (step.kind === PipelineStepKind.Group) {
      for (const leaf of step.steps) ids.push(leaf.id)
    }
  }
  return ids
}

function hasLayer(pipeline: Pipeline | undefined): boolean {
  if (pipeline === undefined) return false
  return leafSteps(pipeline).some(isLayerStep)
}

function canMoveStep(place: Place | undefined, direction: -1 | 1): boolean {
  if (place === undefined) return false
  const target = place.index + direction
  return target >= 0 && target < place.siblings.length
}

function stepKeyEnabled(id: string, now: Snapshot): boolean {
  const place = placeOf(now.pipeline, now.selectedId)
  switch (id) {
    case 'step.group':
      return (
        now.pipeline !== undefined &&
        groupableSteps(now.pipeline, now.marked) !== undefined
      )
    case 'step.ungroup':
      return place?.step.kind === PipelineStepKind.Group
    case 'step.delete':
    case 'step.toggle':
      return place !== undefined
    case 'step.moveUp':
      return canMoveStep(place, -1)
    case 'step.moveDown':
      return canMoveStep(place, 1)
    default:
      return now.pipeline !== undefined && now.pipeline.steps.length > 0
  }
}

function documentEnabled(id: string, now: Snapshot): boolean {
  const { documentId, pipeline } = now
  const pipelines = usePipelineStore.getState()
  const session = pipelines.sessions[documentId]
  const document = documentSession(pipelines, documentId)
  switch (id) {
    case 'edit.undo':
      return session !== undefined && canUndoNow(session)
    case 'edit.redo':
      return session !== undefined && canRedoNow(session)
    case 'file.exportImage':
    case 'file.exportDocument':
      return document !== undefined
    case 'edit.replaceImage':
      return document !== undefined && hasLayer(pipeline)
    case 'edit.showOriginal':
      return document !== undefined && hasEdits(document.confirmed.pipeline)
    default:
      return true
  }
}

/** Whether the action can be done right now; a key that cannot do anything is left to the browser. */
export function canRunAction(id: string, context: ActionContext): boolean {
  const definition = actionById(id)
  if (definition === undefined) return false
  if (!definition.contexts.includes(context.page)) return false
  const { documentId, opener } = context
  switch (id) {
    case 'file.newDocument':
      return true
    case 'file.openImage':
      return !opener.opening
    case 'file.importDocument':
      return !opener.importing
    case 'file.openLibrary':
    case 'view.sidebar':
    case 'view.stepPreview':
    case 'view.runPanel':
    case 'help.shortcuts':
      return true
  }
  if (documentId === undefined) return false
  const now = snapshot(documentId)
  if (definition.tool !== undefined) {
    if (!now.hasSession) return false
    return definition.tool.kind === 'sharp' || context.catalogues !== undefined
  }
  if (id.startsWith('step.')) return stepKeyEnabled(id, now)
  if (id in PAN_STEPS || id.startsWith('view.')) {
    return useUiStore.getState().viewFrames[documentId] !== undefined
  }
  return documentEnabled(id, now)
}

function runViewAction(id: string, documentId: string): void {
  const view = viewportActionsFor(documentId)
  const pan = PAN_STEPS[id]
  if (pan !== undefined) {
    const [dx, dy] = panDistance(pan)
    view.panBy(dx, dy)
    return
  }
  switch (id) {
    case 'view.zoomIn':
      view.zoomIn()
      return
    case 'view.zoomOut':
      view.zoomOut()
      return
    case 'view.fit':
      view.fit()
      return
    case 'view.actualSize':
      view.actualSize()
      return
  }
}

function selectNeighbour(now: Snapshot, direction: -1 | 1): void {
  if (now.pipeline === undefined) return
  const ids = listedStepIds(now.pipeline)
  const at = now.selectedId === undefined ? -1 : ids.indexOf(now.selectedId)
  const fallback = direction === 1 ? 0 : ids.length - 1
  const next = at === -1 ? ids[fallback] : ids[at + direction]
  if (next === undefined) return
  useUiStore.getState().selectStep(now.documentId, next)
}

function runStepAction(id: string, now: Snapshot): void {
  const { documentId } = now
  const place = placeOf(now.pipeline, now.selectedId)
  switch (id) {
    case 'step.group': {
      const problem = groupSteps(documentId, now.marked)
      if (problem !== undefined) useUiStore.getState().setLiveNotice(problem)
      return
    }
    case 'step.ungroup':
      if (place !== undefined) ungroupSteps(documentId, place.step.id)
      return
    case 'step.delete':
      if (place !== undefined) deleteStep(documentId, place.step.id)
      return
    case 'step.toggle':
      if (place !== undefined) {
        setStepOn(documentId, place.step.id, !place.step.enabled)
      }
      return
    case 'step.moveUp':
    case 'step.moveDown':
      if (place === undefined) return
      reorderStep(
        documentId,
        place.step.id,
        place.index + (id === 'step.moveUp' ? -1 : 1),
        place.groupId,
      )
      return
    case 'step.selectUp':
      selectNeighbour(now, -1)
      return
    case 'step.selectDown':
      selectNeighbour(now, 1)
      return
  }
}

/** Where the canvas size is set: a document's Document panel, or a workflow's Canvas in Options. */
function showCanvasSize(id: string, page: Page): void {
  const store = useUiStore.getState()
  if (page === Page.Workflow) {
    store.selectInWorkflow(id, CANVAS_SELECTION)
    store.setActiveTool(Tool.Options)
    return
  }
  store.setActiveTool(Tool.Document)
}

function runDocumentAction(
  id: string,
  documentId: string,
  context: ActionContext,
): void {
  const store = useUiStore.getState()
  switch (id) {
    case 'edit.undo':
      void undoEdit(documentId)
      return
    case 'edit.redo':
      void redoEdit(documentId)
      return
    case 'edit.addImageLayer':
      addEmptyImageLayer(documentId)
      return
    case 'edit.insertImage':
      context.opener.insertImage(documentId)
      return
    case 'edit.replaceImage':
      context.opener.replaceImage(documentId)
      return
    case 'edit.showOriginal':
      store.setShowOriginal(
        documentId,
        !(store.showOriginal[documentId] ?? false),
      )
      return
    case 'file.exportImage':
      store.setActiveTool(Tool.Export)
      return
    case 'file.exportDocument':
      void context.opener.exportDocument(documentId)
      return
    case 'file.close':
      context.closeDocument(documentId)
      return
    case 'edit.setCanvas':
      showCanvasSize(documentId, context.page)
      return
  }
  const panel = PANELS[id]
  if (panel !== undefined) store.setActiveTool(panel)
}

/** Does the action if it can be done now. Returns whether it was, so the key press is only taken from the browser when it did something. */
export function runAction(id: string, context: ActionContext): boolean {
  if (!canRunAction(id, context)) return false
  const definition = actionById(id)
  const store = useUiStore.getState()
  switch (id) {
    case 'file.newDocument':
      store.setNewDocumentOpen(true)
      return true
    case 'file.openImage':
      context.opener.openImage()
      return true
    case 'file.openLibrary':
      context.opener.openLibraryImage()
      return true
    case 'file.importDocument':
      context.opener.importDocument()
      return true
    case 'view.sidebar':
      store.setSidebarOpen(!store.sidebarOpen)
      return true
    case 'view.stepPreview':
      store.toggleWorkflowSidePanel(SidePanelTab.Preview)
      return true
    case 'view.runPanel':
      store.toggleWorkflowSidePanel(SidePanelTab.Runs)
      return true
    case 'help.shortcuts':
      store.setShortcutsOpen(!store.shortcutsOpen)
      return true
  }
  const { documentId, catalogues } = context
  if (documentId === undefined || definition === undefined) return false
  if (definition.tool !== undefined) {
    const problem = addTool(documentId, definition.tool, catalogues ?? [])
    if (problem !== undefined) store.setLiveNotice(problem)
    return true
  }
  const now = snapshot(documentId)
  if (id.startsWith('step.')) runStepAction(id, now)
  else if (id.startsWith('view.')) runViewAction(id, documentId)
  else runDocumentAction(id, documentId, context)
  return true
}
