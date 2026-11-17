import { useNavigate, useRouter, getRouteApi } from '@tanstack/react-router'
import { useCallback } from 'react'

import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from '@/components/ui/menubar'
import { previousDocumentId } from '@/features/documents/document-history'
import { useImageOpener } from '@/features/app/image-opener'
import { signOut } from '@/features/auth/auth-client'
import { canRedoNow, canUndoNow } from '@/features/documents/document-session'
import {
  PipelineStepKind,
  hasEdits,
  leafSteps,
} from '@/features/pipeline/pipeline'
import { redoEdit, undoEdit } from '@/features/documents/document-sync'
import { Tool, useAppStore } from '@/store/app-store'

const rootRoute = getRouteApi('__root__')

const PANEL_ITEMS: ReadonlyArray<{ tool: Tool; label: string }> = [
  { tool: Tool.Tools, label: 'Tools' },
  { tool: Tool.Options, label: 'Options' },
  { tool: Tool.Export, label: 'Export' },
  { tool: Tool.Results, label: 'Results' },
]

function PanelItem({
  tool,
  label,
}: {
  tool: Tool
  label: string
}): React.JSX.Element {
  const setActiveTool = useAppStore((state) => state.setActiveTool)

  const handleSelect = useCallback((): void => {
    setActiveTool(tool)
  }, [setActiveTool, tool])

  return <MenubarItem onSelect={handleSelect}>{label}</MenubarItem>
}

interface AppMenuBarProps {
  /** The document the edit and panel items act on; none on pages without one. */
  documentId?: string
}

/**
 * The application's menu: opening images, editing, the view and the account.
 * It sits at the top of the floating panel, so the page has no header of its
 * own and the image can fill the space.
 */
export function AppMenuBar({ documentId }: AppMenuBarProps): React.JSX.Element {
  const router = useRouter()
  const navigate = useNavigate()
  const { actor } = rootRoute.useRouteContext()
  const opener = useImageOpener()
  const session = useAppStore((state) =>
    documentId === undefined ? undefined : state.documents[documentId],
  )
  const hasSteps = session !== undefined && hasEdits(session.confirmed.pipeline)
  const hasLayer =
    session !== undefined &&
    leafSteps(session.confirmed.pipeline).some(
      (step) => step.kind === PipelineStepKind.Layer,
    )
  const showOriginal = useAppStore((state) =>
    documentId === undefined
      ? false
      : (state.showOriginal[documentId] ?? false),
  )
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen)
  const setShowOriginal = useAppStore((state) => state.setShowOriginal)
  const canUndo = session !== undefined && canUndoNow(session)
  const canRedo = session !== undefined && canRedoNow(session)

  const { documents } = rootRoute.useLoaderData()
  const closeDocumentVisit = useAppStore((state) => state.closeDocumentVisit)

  const handleClose = useCallback((): void => {
    if (documentId === undefined) return
    const { documentHistory } = useAppStore.getState()
    const previous = previousDocumentId(
      documentHistory,
      documentId,
      documents.map(({ id }) => id),
    )
    closeDocumentVisit(documentId)
    if (previous === undefined) {
      void navigate({ to: '/' })
      return
    }
    void navigate({ to: '/documents/$id', params: { id: previous } })
  }, [documentId, documents, closeDocumentVisit, navigate])

  const handleInsertImage = useCallback((): void => {
    if (documentId !== undefined) opener.insertImage(documentId)
  }, [documentId, opener])

  const handleReplaceImage = useCallback((): void => {
    if (documentId !== undefined) opener.replaceImage(documentId)
  }, [documentId, opener])

  const handleExportDocument = useCallback((): void => {
    if (documentId !== undefined) void opener.exportDocument(documentId)
  }, [documentId, opener])

  const handleUndo = useCallback((): void => {
    if (documentId !== undefined) void undoEdit(documentId)
  }, [documentId])

  const handleRedo = useCallback((): void => {
    if (documentId !== undefined) void redoEdit(documentId)
  }, [documentId])

  const handleShowOriginal = useCallback(
    (checked: boolean | 'indeterminate'): void => {
      if (documentId !== undefined)
        setShowOriginal(documentId, checked === true)
    },
    [documentId, setShowOriginal],
  )

  const handleSidebar = useCallback(
    (checked: boolean | 'indeterminate'): void => {
      setSidebarOpen(checked === true)
    },
    [setSidebarOpen],
  )

  const handleSignOut = useCallback((): void => {
    void (async () => {
      await signOut()
      await router.invalidate()
      await navigate({ to: '/sign-in' })
    })()
  }, [router, navigate])

  return (
    <div className="flex min-w-0 flex-col">
      <Menubar aria-label="Application">
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem disabled={opener.opening} onSelect={opener.openImage}>
              Open image
            </MenubarItem>
            <MenubarItem onSelect={opener.openLibraryImage}>
              Open library image
            </MenubarItem>
            <MenubarItem
              disabled={opener.importing}
              onSelect={opener.importDocument}
            >
              Import document…
            </MenubarItem>
            {documentId !== undefined && (
              <>
                <MenubarSeparator />
                <PanelItem tool={Tool.Export} label="Export image" />
                <MenubarItem onSelect={handleExportDocument}>
                  Export document…
                </MenubarItem>
              </>
            )}
            <MenubarSeparator />
            <MenubarItem
              disabled={documentId === undefined}
              onSelect={handleClose}
            >
              Close document
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>Edit</MenubarTrigger>
          <MenubarContent>
            <MenubarItem
              disabled={!canUndo}
              aria-keyshortcuts="Control+Z"
              onSelect={handleUndo}
            >
              Undo
              <MenubarShortcut>Ctrl+Z</MenubarShortcut>
            </MenubarItem>
            <MenubarItem
              disabled={!canRedo}
              aria-keyshortcuts="Control+Shift+Z"
              onSelect={handleRedo}
            >
              Redo
              <MenubarShortcut>Ctrl+Shift+Z</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem
              disabled={documentId === undefined}
              onSelect={handleInsertImage}
            >
              Insert image
            </MenubarItem>
            <MenubarItem disabled={!hasLayer} onSelect={handleReplaceImage}>
              Replace image
            </MenubarItem>
            <MenubarSeparator />
            <MenubarCheckboxItem
              checked={showOriginal}
              disabled={!hasSteps}
              onCheckedChange={handleShowOriginal}
            >
              Show original
            </MenubarCheckboxItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>View</MenubarTrigger>
          <MenubarContent>
            {documentId !== undefined &&
              PANEL_ITEMS.map(({ tool, label }) => (
                <PanelItem key={tool} tool={tool} label={label} />
              ))}
            {documentId !== undefined && <MenubarSeparator />}
            <MenubarCheckboxItem
              checked={sidebarOpen}
              onCheckedChange={handleSidebar}
            >
              Sidebar
            </MenubarCheckboxItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>Account</MenubarTrigger>
          <MenubarContent>
            {actor !== null && <MenubarLabel>{actor.name}</MenubarLabel>}
            <MenubarItem onSelect={handleSignOut}>Sign out</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </div>
  )
}
