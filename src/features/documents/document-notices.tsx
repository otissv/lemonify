import { EditsNotices } from '@/features/documents/edits-notices'
import { usePreview } from '@/features/pipeline/use-preview'
import { documentSession, usePipelineStore } from '@/store/pipeline-store'

interface DocumentNoticesProps {
  documentId: string
}

/** What about a document's edits needs attention; the commands themselves are in the menu and on the keys. */
export function DocumentNotices({
  documentId,
}: DocumentNoticesProps): React.JSX.Element | null {
  const session = usePipelineStore((state) =>
    documentSession(state, documentId),
  )
  const preview = usePreview(documentId)

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
