import { useEffect, useMemo } from 'react'

import type { DocumentView } from '@/features/documents/document'
import { refreshPreview } from '@/features/documents/document-render-sync'
import type { StepProblem } from '@/features/documents/document-render'
import { shownPipeline } from '@/features/documents/document-session'
import {
  previewImageUrl,
  sourceImageUrl,
} from '@/features/documents/image-urls'
import type { Pipeline } from '@/features/pipeline/pipeline'
import { PreviewStatus, useAppStore } from '@/store/app-store'

/** How long edits settle before the preview is asked for, so a burst of changes renders once. */
export const PREVIEW_DELAY_MS = 120

export interface PipelinePreview {
  document: DocumentView
  pipeline: Pipeline
  /** The picture to show: the rendered result, or the source while there are no steps. */
  imageUrl: string
  /** The image as uploaded. */
  originalUrl: string
  status: PreviewStatus
  error: string | undefined
  /** Enabled AI steps that still need running. */
  pending: ReadonlyArray<string>
  /** Steps left out of the picture, with why. */
  problems: ReadonlyArray<StepProblem>
}

/**
 * Keeps the document's preview up to date: asks the server for it shortly
 * after the server has confirmed the latest change, as long as the pipeline has
 * steps (without any, the source is what is shown).
 */
export function usePreviewLoading(documentId: string, enabled: boolean): void {
  const session = useAppStore((state) => state.documents[documentId])
  const settled = session !== undefined && session.pending.length === 0
  const revision = session?.confirmed.revision
  const hasSteps = (session?.confirmed.pipeline.steps.length ?? 0) > 0

  // biome-ignore lint/correctness/useExhaustiveDependencies: the revision is what makes the preview ask again
  useEffect(() => {
    if (!enabled || !settled || !hasSteps) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void refreshPreview(documentId, controller.signal)
    }, PREVIEW_DELAY_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [documentId, enabled, settled, hasSteps, revision])
}

/** What a document looks like after its pipeline. Undefined until the document has loaded. */
export function usePreview(documentId: string): PipelinePreview | undefined {
  const session = useAppStore((state) => state.documents[documentId])
  const current = useAppStore((state) => state.previews[documentId])

  return useMemo(() => {
    if (!session) return undefined
    const pipeline = shownPipeline(session)
    const { source } = session.confirmed
    const rendered =
      pipeline.steps.length > 0 && current?.key !== undefined
        ? previewImageUrl(documentId, current.key)
        : undefined
    return {
      document: session.confirmed,
      pipeline,
      imageUrl: rendered ?? sourceImageUrl(source.id),
      originalUrl: sourceImageUrl(source.id),
      status: current?.status ?? PreviewStatus.Rendering,
      error: current?.error,
      pending: pipeline.steps.length > 0 ? (current?.pendingStepIds ?? []) : [],
      problems: pipeline.steps.length > 0 ? (current?.problems ?? []) : [],
    }
  }, [session, current, documentId])
}
