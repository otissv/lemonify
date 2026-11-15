import { EditsNotices } from '@/features/documents/edits-notices'
import { useUndoShortcuts } from '@/features/documents/use-undo-shortcuts'
import { usePreview } from '@/features/pipeline/use-preview'
import { useAppStore } from '@/store/app-store'

interface DocumentNoticesProps {
  documentId: string
}

/** What about a document's edits needs attention, and the undo and redo keys; the commands themselves are in the menu. */
export function DocumentNotices({
  documentId,
}: DocumentNoticesProps): React.JSX.Element | null {
  const session = useAppStore((state) => state.documents[documentId])
  const preview = usePreview(documentId)
  useUndoShortcuts(documentId)

  if (!session || !preview) return null

  return (
    <div className="absolute top-3 left-3 z-10 flex max-w-96 flex-col items-start gap-2">
      <EditsNotices
        documentId={documentId}
        pendingRenders={preview.pending.length}
        skippedSteps={preview.problems.length}
        renderError={preview.error}
      />
    </div>
  )
}
