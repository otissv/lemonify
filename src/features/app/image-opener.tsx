import { createContext, useCallback, useContext, useMemo } from 'react'

import { TransferStatus } from '@/features/app/transfer-status'
import { DOCUMENT_FILE_EXTENSION } from '@/features/documents/document-file'
import { useExportDocument } from '@/features/documents/use-export-document'
import { useImportDocument } from '@/features/documents/use-import-document'
import { ImageLibraryDialog } from '@/features/library/image-library-dialog'
import { useLibraryRequest } from '@/features/library/use-library-request'
import {
  ACCEPTED_IMAGE_TYPES,
  useOpenImage,
} from '@/features/documents/use-open-image'

export interface ImageOpener {
  /** Asks the person to choose an image from this computer, and opens it as a document. */
  openImage: () => void
  /** Shows the library, to open one of its images as a new document. */
  openLibraryImage: () => void
  /** Shows the library, to add an image to a document as a new Open image step. */
  insertImage: (documentId: string) => void
  /** Shows the library, to replace the selected image of a document. */
  replaceImage: (documentId: string) => void
  opening: boolean
  /** Asks the person to choose a document file from this computer, and opens it as a new document. */
  importDocument: () => void
  importing: boolean
  /** Saves a document as a file, with progress and any refusal shown on the page. */
  exportDocument: (documentId: string) => Promise<void>
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
  const exporter = useExportDocument()
  const library = useLibraryRequest()
  const failure = image.error ?? document.error ?? exporter.error

  const { close: closeLibrary } = library
  const handleLibraryOpenChange = useCallback(
    (open: boolean): void => {
      if (!open) closeLibrary()
    },
    [closeLibrary],
  )

  const value = useMemo<ImageOpener>(
    () => ({
      openImage: image.choose,
      openLibraryImage: library.openLibraryImage,
      insertImage: library.insertImage,
      replaceImage: library.replaceImage,
      opening: image.opening,
      importDocument: document.choose,
      importing: document.importing,
      exportDocument: exporter.exportDocument,
    }),
    [
      image.choose,
      image.opening,
      document.choose,
      document.importing,
      exporter.exportDocument,
      library.openLibraryImage,
      library.insertImage,
      library.replaceImage,
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
      {failure && (
        <p
          role="alert"
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-2 text-caption text-destructive shadow-lg"
        >
          {failure}
        </p>
      )}
      <TransferStatus
        exporting={exporter.status}
        importing={document.importing}
      />
      {library.text && (
        <ImageLibraryDialog
          open
          onOpenChange={handleLibraryOpenChange}
          onChoose={library.choose}
          {...library.text}
        />
      )}
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
