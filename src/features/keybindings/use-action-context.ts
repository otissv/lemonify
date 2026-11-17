import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'

import type { AiCatalogues } from '@/features/ai/ai-defaults'
import { useImageOpener } from '@/features/app/image-opener'
import { previousDocumentId } from '@/features/documents/document-history'
import type { ActionContext } from '@/features/keybindings/action-runner'
import { useAppStore } from '@/store/app-store'

const rootRoute = getRouteApi('__root__')

/** What actions need from the page they run on, so the menu and the keys do exactly the same thing. */
export function useActionContext(
  documentId: string | undefined,
  catalogues?: AiCatalogues,
): ActionContext {
  const opener = useImageOpener()
  const navigate = useNavigate()
  const { documents } = rootRoute.useLoaderData()
  const closeDocumentVisit = useAppStore((state) => state.closeDocumentVisit)

  return useMemo<ActionContext>(
    () => ({
      documentId,
      catalogues,
      opener,
      closeDocument: (closing) => {
        const { documentHistory } = useAppStore.getState()
        const previous = previousDocumentId(
          documentHistory,
          closing,
          documents.map(({ id }) => id),
        )
        closeDocumentVisit(closing)
        if (previous === undefined) {
          void navigate({ to: '/' })
          return
        }
        void navigate({ to: '/documents/$id', params: { id: previous } })
      },
    }),
    [documentId, catalogues, opener, documents, closeDocumentVisit, navigate],
  )
}
