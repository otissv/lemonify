import { useEffect, useState } from 'react'

import { loadDocument } from '@/features/documents/document-sync'
import type { DocumentSession } from '@/features/documents/document-session'
import { errorMessage } from '@/lib/error-message'
import { useAppStore } from '@/store/app-store'

const LOAD_FAILED = 'This image could not be opened.'

export type UseDocument = {
  session: DocumentSession | undefined
  /** Why the document could not be loaded. */
  loadError: string | undefined
}

/** The editor's state of a document, read from the server the first time it is asked for. */
export function useDocument(documentId: string): UseDocument {
  const session = useAppStore((state) => state.documents[documentId])
  const [failure, setFailure] = useState<{ id: string; message: string }>()
  const present = session !== undefined

  useEffect(() => {
    if (present) return
    let current = true
    loadDocument(documentId).catch((error: unknown) => {
      if (current) {
        setFailure({
          id: documentId,
          message: errorMessage(error, LOAD_FAILED),
        })
      }
    })
    return () => {
      current = false
    }
  }, [documentId, present])

  return {
    session,
    loadError: failure?.id === documentId ? failure.message : undefined,
  }
}
