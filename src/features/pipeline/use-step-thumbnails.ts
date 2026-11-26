import { useEffect } from 'react'

import { refreshThumbnails } from '@/features/documents/document-render-sync'
import type { PictureSize } from '@/features/pipeline/canvas'
import { useLibraryStore } from '@/store/library-store'
import { documentSession, usePipelineStore } from '@/store/pipeline-store'

export const THUMBNAIL_DELAY_MS = 300

/** The size in its own pixels of the picture a step acts on, from its small before picture once that is made. */
export function usePictureSizeBefore(
  documentId: string,
  stepId: string | undefined,
): PictureSize | undefined {
  return usePipelineStore((state) =>
    stepId === undefined
      ? undefined
      : state.thumbnails[documentId]?.find(
          (thumbnail) => thumbnail.stepId === stepId && thumbnail.before,
        )?.size,
  )
}

/**
 * Keeps the small pictures of a document's steps up to date while `active`
 * (its steps are shown): asks for them shortly after the server has confirmed
 * the latest change, and again when an AI step has run, since a result makes
 * later steps showable, or something its layers use changed.
 */
export function useStepThumbnails(documentId: string, active: boolean): void {
  const session = usePipelineStore((state) =>
    documentSession(state, documentId),
  )
  const resultsVersion = useLibraryStore((state) => state.resultsVersion)
  const settled = session !== undefined && session.pending.length === 0
  const revision = session?.confirmed.revision
  const pictureVersion = usePipelineStore(
    (state) => state.pictureVersions[documentId],
  )
  const hasSteps = (session?.confirmed.pipeline.steps.length ?? 0) > 0

  // biome-ignore lint/correctness/useExhaustiveDependencies: the revision, results and a change to what layers use make the thumbnails ask again
  useEffect(() => {
    if (!active || !settled || !hasSteps) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void refreshThumbnails(documentId, controller.signal)
    }, THUMBNAIL_DELAY_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [
    documentId,
    active,
    settled,
    hasSteps,
    revision,
    resultsVersion,
    pictureVersion,
  ])
}
