import { loadDocument } from '@/features/pipeline/pipeline-sync'
import type { DocumentSession } from '@/features/pipeline/pipeline-session'
import { useLoadPipeline } from '@/features/pipeline/use-load-pipeline'
import { documentSession, usePipelineStore } from '@/store/pipeline-store'

const LOAD_FAILED = 'This image could not be opened.'

export type UseDocument = {
  session: DocumentSession | undefined
  /** Why the document could not be loaded. */
  loadError: string | undefined
}

/** The editor's state of a document, read from the server the first time it is asked for. */
export function useDocument(documentId: string): UseDocument {
  const session = usePipelineStore((state) =>
    documentSession(state, documentId),
  )
  const loadError = useLoadPipeline(
    documentId,
    session !== undefined,
    loadDocument,
    LOAD_FAILED,
  )
  return { session, loadError }
}
