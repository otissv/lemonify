import { useCallback, useEffect, useRef, useState } from 'react'

import { downloadDocument } from '@/features/documents/download-document'
import { errorMessage } from '@/lib/error-message'

const SAVE_FAILED = 'The document could not be saved.'
export const SAVED_NOTICE_MS = 5000

export type ExportStatus =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'saving'; loaded: number; total: number | undefined }
  | { kind: 'saved'; fileName: string }

export interface ExportDocument {
  status: ExportStatus
  error: string | null
  /** Saves the document as a file, showing progress, and ignores the request while a save is running. */
  exportDocument: (documentId: string) => Promise<void>
}

/** The state of saving a document as a file, for the page to show: preparing, how much has arrived, where it was saved, or why it failed. */
export function useExportDocument(): ExportDocument {
  const [status, setStatus] = useState<ExportStatus>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const running = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const exportDocument = useCallback(
    async (documentId: string): Promise<void> => {
      if (running.current) return
      running.current = true
      clearTimeout(timer.current)
      setError(null)
      setStatus({ kind: 'preparing' })
      try {
        const fileName = await downloadDocument(documentId, (progress) => {
          setStatus({ kind: 'saving', ...progress })
        })
        setStatus({ kind: 'saved', fileName })
        timer.current = setTimeout(() => {
          setStatus({ kind: 'idle' })
        }, SAVED_NOTICE_MS)
      } catch (caught) {
        setStatus({ kind: 'idle' })
        setError(errorMessage(caught, SAVE_FAILED))
      } finally {
        running.current = false
      }
    },
    [],
  )

  return { status, error, exportDocument }
}
