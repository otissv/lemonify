import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { PersistStorage } from 'zustand/middleware'

import type { DocumentView } from '@/features/documents/document'
import {
  closeInHistory,
  visitInHistory,
} from '@/features/documents/document-history'
import type {
  AiRun,
  DocumentPreview,
  DocumentThumbnails,
} from '@/features/documents/document-render'
import { PreviewStatus } from '@/features/documents/document-render'
import { shownPipeline } from '@/features/documents/document-session'
import type {
  DocumentOperation,
  DocumentSession,
  PendingOperation,
} from '@/features/documents/document-session'
import { RealtimeStatus } from '@/features/realtime/realtime-client'
import type { ExportSettings } from '@/features/export/export-settings'
import type { Pipeline } from '@/features/pipeline/pipeline'
import type { PanelPosition } from '@/features/tools/panel-position'
import type { ViewFrame, Viewport } from '@/features/viewport/viewport'

export { PreviewStatus }

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
}

export const MAX_RECENT_UPSCALE_MODELS = 10
export const PREFERENCES_STORAGE_KEY = 'lemonify-preferences'

export enum SidebarTab {
  Editor = 'editor',
  Workflow = 'workflow',
}

interface AppStateData {
  /** The documents opened in this tab, oldest first; the last is on screen. */
  documentHistory: ReadonlyArray<string>
  sidebarOpen: boolean
  sidebarTab: SidebarTab
  panelPosition: PanelPosition | null
  /** Whether the tools panel shows only its menu. */
  panelCollapsed: boolean
  activeTool: Tool
  recentUpscaleModels: ReadonlyArray<string>
  /** Documents whose steps are listed in the sidebar. */
  expandedDocuments: Readonly<Record<string, boolean | undefined>>
  /** The step whose options are shown, by document. */
  selectedSteps: Readonly<Record<string, string | undefined>>
  /** The steps picked together for grouping, by document; the selected step is always among them when there are any. */
  markedSteps: Readonly<Record<string, ReadonlyArray<string> | undefined>>
  /** Groups drawn closed in the sidebar, by group id. Only about the screen: it is not saved in the document. */
  collapsedGroups: Readonly<Record<string, boolean | undefined>>
  documents: Readonly<Record<string, DocumentSession | undefined>>
  /** Documents shown as uploaded instead of as their edits make them. */
  showOriginal: Readonly<Record<string, boolean | undefined>>
  /** How far in each document's canvas is zoomed, and where. Not kept between visits to the app. */
  viewports: Readonly<Record<string, Viewport | undefined>>
  /** The canvas window and picture as last measured, by document, for whatever else shows the view. */
  viewFrames: Readonly<Record<string, ViewFrame | undefined>>
  previews: Readonly<Record<string, DocumentPreview | undefined>>
  thumbnails: Readonly<Record<string, DocumentThumbnails | undefined>>
  aiRuns: Readonly<Record<string, AiRun | undefined>>
  exportSettings: Readonly<Record<string, ExportSettings | undefined>>
  /** Raised when a Result is made or removed, so lists of Results read again. */
  resultsVersion: number
  /** How this tab's live connection is doing. */
  realtime: RealtimeStatus
  /** Something the person should know about a change made elsewhere, until they dismiss it. */
  liveNotice: string | undefined
  /** Whether the keyboard shortcuts dialog is showing. */
  shortcutsOpen: boolean
  /** Whether the new document dialog is showing. */
  newDocumentOpen: boolean
  nextOperationId: number
}

interface AppStateActions {
  setSidebarOpen: (open: boolean) => void
  setSidebarTab: (tab: SidebarTab) => void
  setPanelPosition: (position: PanelPosition) => void
  setPanelCollapsed: (collapsed: boolean) => void
  setActiveTool: (tool: Tool) => void
  setShowOriginal: (documentId: string, show: boolean) => void
  setViewport: (documentId: string, viewport: Viewport) => void
  setViewFrame: (documentId: string, frame: ViewFrame) => void
  rememberUpscaleModel: (name: string) => void
  setDocumentExpanded: (documentId: string, expanded: boolean) => void
  selectStep: (documentId: string, stepId: string | undefined) => void
  /** Replaces the steps picked together. */
  markSteps: (documentId: string, stepIds: ReadonlyArray<string>) => void
  setGroupCollapsed: (groupId: string, collapsed: boolean) => void
  setExportSettings: (documentId: string, settings: ExportSettings) => void
  bumpResults: () => void
  setRealtime: (status: RealtimeStatus) => void
  setLiveNotice: (notice: string | undefined) => void
  setShortcutsOpen: (open: boolean) => void
  setNewDocumentOpen: (open: boolean) => void
  /** Replaces what the server confirmed; waiting operations are dropped when `reset`. */
  confirmDocument: (view: DocumentView, reset: boolean) => void
  /** Takes a newer state from the server and keeps `pending`, the waiting operations made again on top of it. */
  rebaseDocument: (
    view: DocumentView,
    pending: ReadonlyArray<PendingOperation>,
    error: string | undefined,
  ) => void
  forgetDocument: (documentId: string) => void
  visitDocument: (documentId: string) => void
  closeDocumentVisit: (documentId: string) => void
  queueOperation: (documentId: string, op: DocumentOperation) => void
  /** The server accepted the first waiting operation. */
  settleOperation: (view: DocumentView) => void
  setSyncing: (documentId: string, syncing: boolean) => void
  failDocument: (documentId: string, error: string) => void
  setDocumentError: (documentId: string, error: string) => void
  clearDocumentError: (documentId: string) => void
  setPreview: (documentId: string, preview: DocumentPreview) => void
  setThumbnails: (documentId: string, thumbnails: DocumentThumbnails) => void
  setAiRun: (documentId: string, run: AiRun | undefined) => void
}

export type AppState = AppStateData & AppStateActions

export const INITIAL_APP_STATE: Readonly<AppStateData> = {
  sidebarOpen: true,
  sidebarTab: SidebarTab.Editor,
  panelPosition: null,
  panelCollapsed: false,
  activeTool: Tool.Tools,
  recentUpscaleModels: [],
  documentHistory: [],
  expandedDocuments: {},
  selectedSteps: {},
  markedSteps: {},
  collapsedGroups: {},
  documents: {},
  showOriginal: {},
  viewports: {},
  viewFrames: {},
  previews: {},
  thumbnails: {},
  aiRuns: {},
  exportSettings: {},
  resultsVersion: 0,
  realtime: RealtimeStatus.Stopped,
  liveNotice: undefined,
  shortcutsOpen: false,
  newDocumentOpen: false,
  nextOperationId: 1,
}

/** The pipeline on screen for a document, or undefined until it has loaded. */
export function currentPipeline(
  state: Pick<AppStateData, 'documents'>,
  documentId: string,
): Pipeline | undefined {
  const session = state.documents[documentId]
  return session ? shownPipeline(session) : undefined
}

type StoredPreferences = Pick<AppStateData, 'recentUpscaleModels'>

function withRecent(
  recent: ReadonlyArray<string>,
  name: string,
): ReadonlyArray<string> {
  const others = recent.filter((model) => model !== name)
  return [name, ...others].slice(0, MAX_RECENT_UPSCALE_MODELS)
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
    if (useAppStore.persist.hasHydrated()) browserStorage?.setItem(name, value)
  },
  removeItem: (name) => browserStorage?.removeItem(name),
}

function withSession(
  documents: AppStateData['documents'],
  documentId: string,
  update: (session: DocumentSession) => DocumentSession,
): Pick<AppStateData, 'documents'> | Record<string, never> {
  const session = documents[documentId]
  if (!session) return {}
  return { documents: { ...documents, [documentId]: update(session) } }
}

/**
 * App state. Only the per-browser preferences in `StoredPreferences` are kept
 * in localStorage; documents, workflows and results live on the server and are
 * loaded when a page needs them. Rehydration is skipped on creation so the
 * server render and the first client render match; `AppLayout` rehydrates on
 * mount.
 */
export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      ...INITIAL_APP_STATE,
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
      rememberUpscaleModel: (name) => {
        set(({ recentUpscaleModels }) => ({
          recentUpscaleModels: withRecent(recentUpscaleModels, name),
        }))
      },
      setDocumentExpanded: (documentId, expanded) => {
        set(({ expandedDocuments }) => ({
          expandedDocuments: { ...expandedDocuments, [documentId]: expanded },
        }))
      },
      selectStep: (documentId, stepId) => {
        set(({ selectedSteps, markedSteps }) => ({
          selectedSteps: { ...selectedSteps, [documentId]: stepId },
          markedSteps: {
            ...markedSteps,
            [documentId]: stepId === undefined ? [] : [stepId],
          },
        }))
      },
      markSteps: (documentId, stepIds) => {
        set(({ markedSteps }) => ({
          markedSteps: { ...markedSteps, [documentId]: stepIds },
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
      bumpResults: () => {
        set(({ resultsVersion }) => ({ resultsVersion: resultsVersion + 1 }))
      },
      confirmDocument: (view, reset) => {
        set(({ documents }) => {
          const session = documents[view.id]
          const pending = reset || !session ? [] : session.pending
          return {
            documents: {
              ...documents,
              [view.id]: {
                confirmed: view,
                pending,
                syncing: false,
                error: session?.error,
              },
            },
          }
        })
      },
      rebaseDocument: (view, pending, error) => {
        set(({ documents }) =>
          withSession(documents, view.id, (session) => ({
            ...session,
            confirmed: view,
            pending,
            error,
          })),
        )
      },
      visitDocument: (documentId) => {
        set(({ documentHistory }) => ({
          documentHistory: visitInHistory(documentHistory, documentId),
        }))
      },
      closeDocumentVisit: (documentId) => {
        set(({ documentHistory }) => ({
          documentHistory: closeInHistory(documentHistory, documentId),
        }))
      },
      forgetDocument: (documentId) => {
        set(
          ({
            documentHistory,
            documents,
            previews,
            thumbnails,
            aiRuns,
            expandedDocuments,
            selectedSteps,
            markedSteps,
            showOriginal,
            viewports,
            viewFrames,
          }) => {
            const without = <T>(
              record: Readonly<Record<string, T | undefined>>,
            ): Record<string, T | undefined> => {
              const { [documentId]: _removed, ...rest } = record
              return rest
            }
            return {
              documentHistory: closeInHistory(documentHistory, documentId),
              documents: without(documents),
              previews: without(previews),
              thumbnails: without(thumbnails),
              aiRuns: without(aiRuns),
              expandedDocuments: without(expandedDocuments),
              selectedSteps: without(selectedSteps),
              markedSteps: without(markedSteps),
              showOriginal: without(showOriginal),
              viewports: without(viewports),
              viewFrames: without(viewFrames),
            }
          },
        )
      },
      queueOperation: (documentId, op) => {
        set(({ documents, nextOperationId }) => ({
          ...withSession(documents, documentId, (session) => ({
            ...session,
            error: undefined,
            pending: [...session.pending, { id: nextOperationId, op }],
          })),
          nextOperationId: nextOperationId + 1,
        }))
      },
      settleOperation: (view) => {
        set(({ documents }) =>
          withSession(documents, view.id, (session) => ({
            ...session,
            confirmed: view,
            pending: session.pending.slice(1),
          })),
        )
      },
      setSyncing: (documentId, syncing) => {
        set(({ documents }) =>
          withSession(documents, documentId, (session) => ({
            ...session,
            syncing,
          })),
        )
      },
      failDocument: (documentId, error) => {
        set(({ documents }) =>
          withSession(documents, documentId, (session) => ({
            ...session,
            pending: [],
            syncing: false,
            error,
          })),
        )
      },
      setDocumentError: (documentId, error) => {
        set(({ documents }) =>
          withSession(documents, documentId, (session) => ({
            ...session,
            error,
          })),
        )
      },
      clearDocumentError: (documentId) => {
        set(({ documents }) =>
          withSession(documents, documentId, (session) => ({
            ...session,
            error: undefined,
          })),
        )
      },
      setPreview: (documentId, preview) => {
        set(({ previews }) => ({
          previews: { ...previews, [documentId]: preview },
        }))
      },
      setThumbnails: (documentId, thumbnails) => {
        set((state) => ({
          thumbnails: { ...state.thumbnails, [documentId]: thumbnails },
        }))
      },
      setAiRun: (documentId, run) => {
        set(({ aiRuns }) => ({ aiRuns: { ...aiRuns, [documentId]: run } }))
      },
    }),
    {
      name: PREFERENCES_STORAGE_KEY,
      storage: preferencesStorage,
      partialize: ({ recentUpscaleModels }): StoredPreferences => ({
        recentUpscaleModels,
      }),
      skipHydration: true,
    },
  ),
)
