import { useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback, useState } from 'react'

import type { SourceSummary } from '@/features/documents/document'
import { createDocument } from '@/features/documents/document-functions'
import {
  LibraryRequestKind,
  describeLibraryRequest,
} from '@/features/library/library-request'
import type {
  LibraryDialogText,
  LibraryRequest,
} from '@/features/library/library-request'
import { insertImage, replaceImage } from '@/features/pipeline/pipeline-actions'

export interface LibraryRequests {
  /** The request being answered in the library dialog, or none. */
  request: LibraryRequest | null
  /** The words of the dialog for the request; undefined while there is none. */
  text: LibraryDialogText | undefined
  openLibraryImage: () => void
  insertImage: (documentId: string) => void
  replaceImage: (documentId: string) => void
  close: () => void
  /** Does what the request asks with the images chosen; throws when it cannot. */
  choose: (sources: ReadonlyArray<SourceSummary>) => Promise<void>
}

/**
 * The library dialog's one request at a time: open a new document, or insert
 * or replace an image in one. The three look alike to the person, so they share
 * one dialog and are told apart here.
 */
export function useLibraryRequest(): LibraryRequests {
  const navigate = useNavigate()
  const router = useRouter()
  const [request, setRequest] = useState<LibraryRequest | null>(null)

  const openLibraryImage = useCallback((): void => {
    setRequest({ kind: LibraryRequestKind.Open })
  }, [])
  const insert = useCallback((documentId: string): void => {
    setRequest({ kind: LibraryRequestKind.Insert, documentId })
  }, [])
  const replace = useCallback((documentId: string): void => {
    setRequest({ kind: LibraryRequestKind.Replace, documentId })
  }, [])
  const close = useCallback((): void => {
    setRequest(null)
  }, [])

  const choose = useCallback(
    async (sources: ReadonlyArray<SourceSummary>): Promise<void> => {
      const [first] = sources
      if (request === null || first === undefined) return
      switch (request.kind) {
        case LibraryRequestKind.Open: {
          const document = await createDocument({
            data: { sourceId: first.id },
          })
          await router.invalidate()
          await navigate({ to: '/documents/$id', params: { id: document.id } })
          return
        }
        case LibraryRequestKind.Insert:
          for (const source of sources)
            insertImage(request.documentId, source.id)
          return
        case LibraryRequestKind.Replace:
          replaceImage(request.documentId, first.id)
          return
      }
    },
    [request, navigate, router],
  )

  return {
    request,
    text: request === null ? undefined : describeLibraryRequest(request),
    openLibraryImage,
    insertImage: insert,
    replaceImage: replace,
    close,
    choose,
  }
}
