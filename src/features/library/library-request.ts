export enum LibraryRequestKind {
  /** Open a new document on an image. */
  Open = 'open',
  /** Add an image to a document as an Open image step. */
  Insert = 'insert',
  /** Swap the image a document opens for another. */
  Replace = 'replace',
}

/** What the person is choosing an image for. Insert and replace belong to a document. */
export type LibraryRequest =
  | { kind: LibraryRequestKind.Open }
  | { kind: LibraryRequestKind.Insert; documentId: string }
  | { kind: LibraryRequestKind.Replace; documentId: string }

export interface LibraryDialogText {
  title: string
  description: string
  /** Present when the dialog also uploads from this computer. */
  uploadLabel?: string
}

const UPLOAD_LABEL = 'Upload from computer…'

/** The words of the library dialog for a request, so each says what choosing an image will do. */
export function describeLibraryRequest(
  request: LibraryRequest,
): LibraryDialogText {
  switch (request.kind) {
    case LibraryRequestKind.Open:
      return {
        title: 'Open library image',
        description: 'Open a new document on an image from your library.',
      }
    case LibraryRequestKind.Insert:
      return {
        title: 'Insert image',
        description:
          'Add an image from your library, or upload one, before the selected step, so that step and the ones after it can use it.',
        uploadLabel: UPLOAD_LABEL,
      }
    case LibraryRequestKind.Replace:
      return {
        title: 'Replace image',
        description:
          'Replace the selected image, or the document’s own image, with one from your library, or upload one.',
        uploadLabel: UPLOAD_LABEL,
      }
  }
}
