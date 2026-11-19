import { OverlayGuide } from '@/features/overlay/grid-guides'
import type { StepViewPart } from '@/features/overlay/step-view'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { PersistStorage } from 'zustand/middleware'

import { closeInTrail, visitInTrail } from '@/features/documents/visit-trail'
import type { ExportSettings } from '@/features/export/export-settings'
import { RealtimeStatus } from '@/features/realtime/realtime-client'
import type { PanelPosition } from '@/features/tools/panel-position'
import type { ViewFrame, Viewport } from '@/features/viewport/viewport'
import type { RunCanvasMode } from '@/features/workflows/workflow'
import {
  NO_SELECTION,
  stepSelection,
} from '@/features/workflows/workflow-selection'
import type {
  Selection,
  WorkflowFocus,
} from '@/features/workflows/workflow-selection'

export enum Tool {
  /** The browser of tools to add as steps. */
  Tools = 'tools',
  /** The options of the selected step. */
  Options = 'options',
  Export = 'export',
  /** The AI results and exports kept for the document. */
  Results = 'results',
  /** What the document is: its image, steps and dates. */
  Document = 'document',
  /** A small view of the whole picture, to move around it and zoom. */
  Navigator = 'navigator',
  /** Starting a workflow and following its runs. */
  Run = 'run',
}

export enum SidebarTab {
  Editor = 'editor',
  Workflow = 'workflow',
}

export const MAX_RECENT_UPSCALE_MODELS = 10
export const PREFERENCES_STORAGE_KEY = 'lemonify-preferences'

type Keyed<T> = Readonly<Record<string, T | undefined>>

interface UiStateData {
  /** The documents and workflows opened in this tab, oldest first; the last is on screen. */
  visitTrail: ReadonlyArray<string>
  sidebarOpen: boolean
  sidebarTab: SidebarTab
  panelPosition: PanelPosition | null
  /** Whether the tools panel shows only its menu. */
  panelCollapsed: boolean
  activeTool: Tool
  recentUpscaleModels: ReadonlyArray<string>
  /** The lines drawn inside the box of a tool on the picture, such as extract. Kept in this browser. */
  overlayGuide: OverlayGuide
  /** Documents and workflows whose steps are listed in the sidebar. */
  expandedItems: Keyed<boolean>
  /** The step whose options are shown, by document or workflow. */
  selectedSteps: Keyed<string>
  /** The steps picked together for grouping, by document or workflow; the selected step is always among them when there are any. */
  markedSteps: Keyed<ReadonlyArray<string>>
  /** The part of a workflow other than a step that its options panel shows, by workflow id. Selecting a step clears it, and focusing it clears the selected step, so one thing is selected at a time. */
  workflowFocus: Keyed<WorkflowFocus>
  /** Which canvas each workflow's next run draws on. */
  runCanvasModes: Keyed<RunCanvasMode>
  /** Groups drawn closed in the sidebar, by group id. Only about the screen: it is not saved. */
  collapsedGroups: Keyed<boolean>
  /** Documents shown as uploaded instead of as their edits make them. */
  showOriginal: Keyed<boolean>
  /** Which picture of the selected step the canvas shows, by document; the edit picture when not set. Selecting another step clears it. */
  stepViews: Keyed<StepViewPart>
  /** How far in each document's canvas is zoomed, and where. Not kept between visits to the app. */
  viewports: Keyed<Viewport>
  /** The canvas window and picture as last measured, by document, for whatever else shows the view. */
  viewFrames: Keyed<ViewFrame>
  exportSettings: Keyed<ExportSettings>
  /** How this tab's live connection is doing. */
  realtime: RealtimeStatus
  /** Something the person should know about a change made elsewhere, until they dismiss it. */
  liveNotice: string | undefined
  /** Whether the keyboard shortcuts dialog is showing. */
  shortcutsOpen: boolean
  /** Whether the new document dialog is showing. */
  newDocumentOpen: boolean
}

interface UiStateActions {
  setSidebarOpen: (open: boolean) => void
  setSidebarTab: (tab: SidebarTab) => void
  setPanelPosition: (position: PanelPosition) => void
  setPanelCollapsed: (collapsed: boolean) => void
  setActiveTool: (tool: Tool) => void
  setOverlayGuide: (guide: OverlayGuide) => void
  setStepView: (documentId: string, part: StepViewPart) => void
  setShowOriginal: (documentId: string, show: boolean) => void
  setViewport: (documentId: string, viewport: Viewport) => void
  setViewFrame: (documentId: string, frame: ViewFrame) => void
  rememberUpscaleModel: (name: string) => void
  setItemExpanded: (id: string, expanded: boolean) => void
  selectStep: (id: string, stepId: string | undefined) => void
  /** Replaces the steps picked together. */
  markSteps: (id: string, stepIds: ReadonlyArray<string>) => void
  /** Chooses what a workflow's options show: a step, its canvas, inputs or output, or nothing. */
  selectInWorkflow: (workflowId: string, selection: Selection) => void
  setRunCanvasMode: (workflowId: string, mode: RunCanvasMode) => void
  setGroupCollapsed: (groupId: string, collapsed: boolean) => void
  setExportSettings: (documentId: string, settings: ExportSettings) => void
  setRealtime: (status: RealtimeStatus) => void
  setLiveNotice: (notice: string | undefined) => void
  setShortcutsOpen: (open: boolean) => void
  setNewDocumentOpen: (open: boolean) => void
  visitItem: (id: string) => void
  closeVisit: (id: string) => void
  /** Drops everything the screen remembers about a document or workflow. */
  forgetUi: (id: string) => void
}

export type UiState = UiStateData & UiStateActions

export const INITIAL_UI_STATE: Readonly<UiStateData> = {
  sidebarOpen: true,
  sidebarTab: SidebarTab.Editor,
  panelPosition: null,
  panelCollapsed: false,
  activeTool: Tool.Tools,
  recentUpscaleModels: [],
  overlayGuide: OverlayGuide.None,
  visitTrail: [],
  expandedItems: {},
  selectedSteps: {},
  markedSteps: {},
  workflowFocus: {},
  runCanvasModes: {},
  collapsedGroups: {},
  showOriginal: {},
  stepViews: {},
  viewports: {},
  viewFrames: {},
  exportSettings: {},
  realtime: RealtimeStatus.Stopped,
  liveNotice: undefined,
  shortcutsOpen: false,
  newDocumentOpen: false,
}

/** What a workflow's options panel shows: its focused part, else its selected step, else nothing. */
export function workflowSelectionOf(
  state: Pick<UiStateData, 'workflowFocus' | 'selectedSteps'>,
  workflowId: string,
): Selection {
  const focus = state.workflowFocus[workflowId]
  if (focus !== undefined) return { kind: focus }
  const stepId = state.selectedSteps[workflowId]
  return stepId === undefined ? NO_SELECTION : stepSelection(stepId)
}

type StoredPreferences = Pick<
  UiStateData,
  'recentUpscaleModels' | 'overlayGuide'
>

function withRecent(
  recent: ReadonlyArray<string>,
  name: string,
): ReadonlyArray<string> {
  const others = recent.filter((model) => model !== name)
  return [name, ...others].slice(0, MAX_RECENT_UPSCALE_MODELS)
}

function without<T>(
  record: Keyed<T>,
  id: string,
): Record<string, T | undefined> {
  const { [id]: _removed, ...rest } = record
  return rest
}

const browserStorage = createJSONStorage<StoredPreferences>(() => localStorage)

/**
 * localStorage, but writes wait until the stored preferences have been read
 * back, so state set before then cannot overwrite them. There is no storage
 * during server rendering.
 */
const preferencesStorage: PersistStorage<StoredPreferences> = {
  getItem: (name) => browserStorage?.getItem(name) ?? null,
  setItem: (name, value) => {
    if (useUiStore.persist.hasHydrated()) browserStorage?.setItem(name, value)
  },
  removeItem: (name) => browserStorage?.removeItem(name),
}

/**
 * What the screen remembers: layout, tools, selections, zoom and the dialogs
 * that are open. Only the per-browser preferences in `StoredPreferences` are
 * kept in localStorage. Documents, workflows, their renders and the library
 * are in the other stores, and nothing is held in two of them. Rehydration is
 * skipped on creation so the server render and the first client render match;
 * `AppLayout` rehydrates on mount.
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      ...INITIAL_UI_STATE,
      setSidebarOpen: (sidebarOpen) => {
        set({ sidebarOpen })
      },
      setSidebarTab: (sidebarTab) => {
        set({ sidebarTab })
      },
      setPanelPosition: (panelPosition) => {
        set({ panelPosition })
      },
      setPanelCollapsed: (panelCollapsed) => {
        set({ panelCollapsed })
      },
      setActiveTool: (activeTool) => {
        set({ activeTool })
      },
      setShowOriginal: (documentId, show) => {
        set(({ showOriginal }) => ({
          showOriginal: { ...showOriginal, [documentId]: show },
        }))
      },
      setViewport: (documentId, viewport) => {
        set(({ viewports }) => ({
          viewports: { ...viewports, [documentId]: viewport },
        }))
      },
      setViewFrame: (documentId, frame) => {
        set(({ viewFrames }) => ({
          viewFrames: { ...viewFrames, [documentId]: frame },
        }))
      },
      setOverlayGuide: (overlayGuide) => {
        set({ overlayGuide })
      },
      rememberUpscaleModel: (name) => {
        set(({ recentUpscaleModels }) => ({
          recentUpscaleModels: withRecent(recentUpscaleModels, name),
        }))
      },
      setItemExpanded: (id, expanded) => {
        set(({ expandedItems }) => ({
          expandedItems: { ...expandedItems, [id]: expanded },
        }))
      },
      setStepView: (documentId, part) => {
        set(({ stepViews }) => ({
          stepViews: { ...stepViews, [documentId]: part },
        }))
      },
      selectStep: (id, stepId) => {
        set(({ selectedSteps, markedSteps, workflowFocus, stepViews }) => ({
          stepViews:
            selectedSteps[id] === stepId ? stepViews : without(stepViews, id),
          workflowFocus:
            stepId === undefined ? workflowFocus : without(workflowFocus, id),
          selectedSteps: { ...selectedSteps, [id]: stepId },
          markedSteps: {
            ...markedSteps,
            [id]: stepId === undefined ? [] : [stepId],
          },
        }))
      },
      markSteps: (id, stepIds) => {
        set(({ markedSteps }) => ({
          markedSteps: { ...markedSteps, [id]: stepIds },
        }))
      },
      selectInWorkflow: (workflowId, selection) => {
        const stepId = selection.kind === 'step' ? selection.id : undefined
        const focus =
          selection.kind === 'step' || selection.kind === 'none'
            ? undefined
            : selection.kind
        set(({ workflowFocus, selectedSteps, markedSteps }) => ({
          workflowFocus: { ...workflowFocus, [workflowId]: focus },
          selectedSteps: { ...selectedSteps, [workflowId]: stepId },
          markedSteps: {
            ...markedSteps,
            [workflowId]: stepId === undefined ? [] : [stepId],
          },
        }))
      },
      setRunCanvasMode: (workflowId, mode) => {
        set(({ runCanvasModes }) => ({
          runCanvasModes: { ...runCanvasModes, [workflowId]: mode },
        }))
      },
      setGroupCollapsed: (groupId, collapsed) => {
        set(({ collapsedGroups }) => ({
          collapsedGroups: { ...collapsedGroups, [groupId]: collapsed },
        }))
      },
      setExportSettings: (documentId, settings) => {
        set(({ exportSettings }) => ({
          exportSettings: { ...exportSettings, [documentId]: settings },
        }))
      },
      setRealtime: (realtime) => {
        set({ realtime })
      },
      setLiveNotice: (liveNotice) => {
        set({ liveNotice })
      },
      setShortcutsOpen: (shortcutsOpen) => {
        set({ shortcutsOpen })
      },
      setNewDocumentOpen: (newDocumentOpen) => {
        set({ newDocumentOpen })
      },
      visitItem: (id) => {
        set(({ visitTrail }) => ({ visitTrail: visitInTrail(visitTrail, id) }))
      },
      closeVisit: (id) => {
        set(({ visitTrail }) => ({ visitTrail: closeInTrail(visitTrail, id) }))
      },
      forgetUi: (id) => {
        set((state) => ({
          visitTrail: closeInTrail(state.visitTrail, id),
          expandedItems: without(state.expandedItems, id),
          selectedSteps: without(state.selectedSteps, id),
          markedSteps: without(state.markedSteps, id),
          workflowFocus: without(state.workflowFocus, id),
          runCanvasModes: without(state.runCanvasModes, id),
          showOriginal: without(state.showOriginal, id),
          stepViews: without(state.stepViews, id),
          viewports: without(state.viewports, id),
          viewFrames: without(state.viewFrames, id),
          exportSettings: without(state.exportSettings, id),
        }))
      },
    }),
    {
      name: PREFERENCES_STORAGE_KEY,
      storage: preferencesStorage,
      partialize: ({
        recentUpscaleModels,
        overlayGuide,
      }): StoredPreferences => ({ recentUpscaleModels, overlayGuide }),
      skipHydration: true,
    },
  ),
)
