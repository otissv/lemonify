import { useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback, useRef, useState } from 'react'

import { createDocument } from '@/features/documents/document-functions'
import { uploadSource } from '@/features/documents/upload-source'
import { errorMessage } from '@/lib/error-message'

const OPEN_FAILED = 'The image could not be opened.'
export const ACCEPTED_IMAGE_TYPES =
  'image/png,image/jpeg,image/webp,image/avif,image/gif'

export interface OpenImage {
  inputRef: React.RefObject<HTMLInputElement | null>
  /** Asks the person to choose an image from this computer. */
  choose: () => void
  /** Uploads the chosen image and opens it as a new document. */
  handleChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  opening: boolean
  error: string | null
}

export function useOpenImage(): OpenImage {
  const navigate = useNavigate()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = useCallback((): void => {
    inputRef.current?.click()
  }, [])

  const open = useCallback(
    async (file: File): Promise<void> => {
      setOpening(true)
      setError(null)
      try {
        const source = await uploadSource(file)
        const document = await createDocument({
          data: { sourceId: source.id },
        })
        await router.invalidate()
        await navigate({ to: '/documents/$id', params: { id: document.id } })
      } catch (caught) {
        setError(errorMessage(caught, OPEN_FAILED))
      } finally {
        setOpening(false)
      }
    },
    [navigate, router],
  )

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.item(0)
      event.target.value = ''
      if (file) void open(file)
    },
    [open],
  )

  return { inputRef, choose, handleChange, opening, error }
}
