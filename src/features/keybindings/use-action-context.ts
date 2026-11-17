import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'

import type { AiCatalogues } from '@/features/ai/ai-defaults'
import { useImageOpener } from '@/features/app/image-opener'
import { previousVisit } from '@/features/documents/visit-trail'
import type { ActionContext } from '@/features/keybindings/action-runner'
import { useUiStore } from '@/store/ui-store'

const rootRoute = getRouteApi('__root__')

/** What actions need from the page they run on, so the menu and the keys do exactly the same thing. */
export function useActionContext(
  documentId: string | undefined,
  catalogues?: AiCatalogues,
): ActionContext {
  const opener = useImageOpener()
  const navigate = useNavigate()
  const { documents, workflows } = rootRoute.useLoaderData()
  const closeDocumentVisit = useUiStore((state) => state.closeVisit)

  return useMemo<ActionContext>(
    () => ({
      documentId,
      catalogues,
      opener,
      closeDocument: (closing) => {
        const { visitTrail } = useUiStore.getState()
        const previous = previousVisit(visitTrail, closing, [
          ...documents.map(({ id }) => ({ id, kind: 'document' as const })),
          ...workflows.map(({ id }) => ({ id, kind: 'workflow' as const })),
        ])
        closeDocumentVisit(closing)
        if (previous === undefined) {
          void navigate({ to: '/' })
          return
        }
        if (previous.kind === 'workflow') {
          void navigate({ to: '/workflows/$id', params: { id: previous.id } })
          return
        }
        void navigate({ to: '/documents/$id', params: { id: previous.id } })
      },
    }),
    [
      documentId,
      catalogues,
      opener,
      documents,
      workflows,
      closeDocumentVisit,
      navigate,
    ],
  )
}
