import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'

import { DOCUMENT_FILE_EXTENSION } from '@/features/documents/document-file'
import { useImportDocument } from '@/features/documents/use-import-document'
import { SourcePickerDialog } from '@/features/documents/source-picker-dialog'
import {
  ACCEPTED_IMAGE_TYPES,
  useOpenImage,
} from '@/features/documents/use-open-image'

export interface ImageOpener {
  /** Asks the person to choose an image from this computer, and opens it as a document. */
  openImage: () => void
  /** Shows the images already uploaded, to open one as a new document. */
  showUploadedImages: () => void
  opening: boolean
  /** Asks the person to choose a document file from this computer, and opens it as a new document. */
  importDocument: () => void
  importing: boolean
}

const ImageOpenerContext = createContext<ImageOpener | null>(null)

/**
 * Owns the one file chooser and the one uploaded-images picker of the whole
 * app, so the menu and the welcome page open images the same way and the page
 * holds no second copy of either. A refused image is reported in an alert that
 * floats over the page, since the caller may be a menu that closes at once.
 */
export function ImageOpenerProvider({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const image = useOpenImage()
  const document = useImportDocument()
  const [pickerOpen, setPickerOpen] = useState(false)

  const showUploadedImages = useCallback((): void => {
    setPickerOpen(true)
  }, [])

  const value = useMemo<ImageOpener>(
    () => ({
      openImage: image.choose,
      showUploadedImages,
      opening: image.opening,
      importDocument: document.choose,
      importing: document.importing,
    }),
    [
      image.choose,
      image.opening,
      document.choose,
      document.importing,
      showUploadedImages,
    ],
  )

  return (
    <ImageOpenerContext.Provider value={value}>
      <input
        ref={image.inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        aria-label="Choose an image"
        className="sr-only"
        tabIndex={-1}
        onChange={image.handleChange}
      />
      <input
        ref={document.inputRef}
        type="file"
        accept={DOCUMENT_FILE_EXTENSION}
        aria-label="Choose a document file"
        className="sr-only"
        tabIndex={-1}
        onChange={document.handleChange}
      />
      {(image.error ?? document.error) && (
        <p
          role="alert"
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-2 text-caption text-destructive shadow-lg"
        >
          {image.error ?? document.error}
        </p>
      )}
      <SourcePickerDialog open={pickerOpen} onOpenChange={setPickerOpen} />
      {children}
    </ImageOpenerContext.Provider>
  )
}

export function useImageOpener(): ImageOpener {
  const opener = useContext(ImageOpenerContext)
  if (opener === null) {
    throw new Error('useImageOpener needs an ImageOpenerProvider above it.')
  }
  return opener
}
