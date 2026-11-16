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
} from '@/features/documents/document-session'
import type { ExportSettings } from '@/features/export/export-settings'
import type { Pipeline } from '@/features/pipeline/pipeline'
import type { PanelPosition } from '@/features/tools/panel-position'

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
  documents: Readonly<Record<string, DocumentSession | undefined>>
  /** Documents shown as uploaded instead of as their edits make them. */
  showOriginal: Readonly<Record<string, boolean | undefined>>
  previews: Readonly<Record<string, DocumentPreview | undefined>>
  thumbnails: Readonly<Record<string, DocumentThumbnails | undefined>>
  aiRuns: Readonly<Record<string, AiRun | undefined>>
  exportSettings: Readonly<Record<string, ExportSettings | undefined>>
  /** Raised when a Result is made or removed, so lists of Results read again. */
  resultsVersion: number
  nextOperationId: number
}

interface AppStateActions {
  setSidebarOpen: (open: boolean) => void
  setSidebarTab: (tab: SidebarTab) => void
  setPanelPosition: (position: PanelPosition) => void
  setPanelCollapsed: (collapsed: boolean) => void
  setActiveTool: (tool: Tool) => void
  setShowOriginal: (documentId: string, show: boolean) => void
  rememberUpscaleModel: (name: string) => void
  setDocumentExpanded: (documentId: string, expanded: boolean) => void
  selectStep: (documentId: string, stepId: string | undefined) => void
  setExportSettings: (documentId: string, settings: ExportSettings) => void
  bumpResults: () => void
  /** Replaces what the server confirmed; waiting operations are dropped when `reset`. */
  confirmDocument: (view: DocumentView, reset: boolean) => void
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
  documents: {},
  showOriginal: {},
  previews: {},
  thumbnails: {},
  aiRuns: {},
  exportSettings: {},
  resultsVersion: 0,
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
        set(({ selectedSteps }) => ({
          selectedSteps: { ...selectedSteps, [documentId]: stepId },
        }))
      },
      setExportSettings: (documentId, settings) => {
        set(({ exportSettings }) => ({
          exportSettings: { ...exportSettings, [documentId]: settings },
        }))
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
            showOriginal,
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
              showOriginal: without(showOriginal),
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
