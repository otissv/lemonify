import { useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback, useRef, useState } from 'react'

import { uploadDocumentFile } from '@/features/documents/upload-document-file'
import { errorMessage } from '@/lib/error-message'

const IMPORT_FAILED = 'The document could not be opened.'

export interface ImportDocument {
  inputRef: React.RefObject<HTMLInputElement | null>
  /** Asks the person to choose a document file from this computer. */
  choose: () => void
  /** Sends the chosen file and opens the new document. */
  handleChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  importing: boolean
  error: string | null
}

export function useImportDocument(): ImportDocument {
  const navigate = useNavigate()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = useCallback((): void => {
    inputRef.current?.click()
  }, [])

  const run = useCallback(
    async (file: File): Promise<void> => {
      setImporting(true)
      setError(null)
      try {
        const id = await uploadDocumentFile(file)
        await router.invalidate()
        await navigate({ to: '/documents/$id', params: { id } })
      } catch (caught) {
        setError(errorMessage(caught, IMPORT_FAILED))
      } finally {
        setImporting(false)
      }
    },
    [navigate, router],
  )

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.item(0)
      event.target.value = ''
      if (file) void run(file)
    },
    [run],
  )

  return { inputRef, choose, handleChange, importing, error }
}
