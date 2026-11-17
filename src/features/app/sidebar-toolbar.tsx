import { RiFolderAddLine, RiImageAddLine, RiImageLine } from '@remixicon/react'
import { useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { SidebarFooter } from '@/components/ui/sidebar'
import { useImageOpener } from '@/features/app/image-opener'
import { groupableSteps } from '@/features/pipeline/pipeline'
import { groupSteps } from '@/features/pipeline/pipeline-actions'
import { shownPipeline } from '@/features/documents/document-session'
import { useAppStore } from '@/store/app-store'

/** Whether the steps picked in the sidebar can be put in a group. */
function useCanGroup(documentId: string | undefined): boolean {
  const marked = useAppStore((state) =>
    documentId === undefined ? undefined : state.markedSteps[documentId],
  )
  const session = useAppStore((state) =>
    documentId === undefined ? undefined : state.documents[documentId],
  )
  return useMemo(() => {
    if (session === undefined || marked === undefined) return false
    return groupableSteps(shownPipeline(session), marked) !== undefined
  }, [session, marked])
}

/** The small toolbar at the bottom of the sidebar: open an image from the library, and group the picked steps. */
export function SidebarToolbar(): React.JSX.Element {
  const { id: documentId } = useParams({ strict: false })
  const opener = useImageOpener()
  const canGroup = useCanGroup(documentId)
  const marked = useAppStore((state) =>
    documentId === undefined ? undefined : state.markedSteps[documentId],
  )
  const [error, setError] = useState<string | undefined>(undefined)

  function handleOpen(): void {
    opener.openImage()
  }

  function handleLibrary(): void {
    opener.openLibraryImage()
  }

  function handleGroup(): void {
    if (documentId === undefined) return
    setError(groupSteps(documentId, marked ?? []))
  }

  return (
    <SidebarFooter
      aria-label="Sidebar toolbar"
      className="gap-1 border-t border-sidebar-border"
    >
      <div role="toolbar" aria-label="Image tools" className="flex gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open image"
          title="Open an image from this computer"
          disabled={opener.opening}
          onClick={handleOpen}
        >
          <RiImageLine aria-hidden="true" className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open image library"
          title="Open image library"
          onClick={handleLibrary}
        >
          <RiImageAddLine aria-hidden="true" className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Group selected steps"
          title="Group selected steps (pick steps with ctrl or shift)"
          disabled={!canGroup}
          onClick={handleGroup}
        >
          <RiFolderAddLine aria-hidden="true" className="size-4" />
        </Button>
      </div>
      {error !== undefined && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </SidebarFooter>
  )
}
