import { useEffect, useMemo } from 'react'

import type { DocumentView, SourceSummary } from '@/features/documents/document'
import { refreshPreview } from '@/features/documents/document-render-sync'
import type { StepProblem } from '@/features/documents/document-render'
import { shownPipeline } from '@/features/documents/document-session'
import {
  previewImageUrl,
  sourceImageUrl,
} from '@/features/documents/image-urls'
import { originalSourceId } from '@/features/pipeline/pipeline'
import type { Pipeline } from '@/features/pipeline/pipeline'
import { PreviewStatus, useAppStore } from '@/store/app-store'

/** How long edits settle before the preview is asked for, so a burst of changes renders once. */
export const PREVIEW_DELAY_MS = 120

export interface PipelinePreview {
  document: DocumentView
  pipeline: Pipeline
  /** The image of the first image layer that is on: the document's original. Undefined when there is none. */
  source: SourceSummary | undefined
  /** The rendered picture. Undefined until the first render is ready. */
  imageUrl: string | undefined
  /** The original image, as opened, before any edit. */
  originalUrl: string | undefined
  status: PreviewStatus
  error: string | undefined
  /** Enabled AI steps that still need running. */
  pending: ReadonlyArray<string>
  /** Steps left out of the picture, with why. */
  problems: ReadonlyArray<StepProblem>
}

/** The image of the first image layer that is on, as far as the document's images are known. */
export function activeSource(
  pipeline: Pipeline,
  sources: ReadonlyArray<SourceSummary>,
): SourceSummary | undefined {
  const id = originalSourceId(pipeline)
  return sources.find((source) => source.id === id)
}

/**
 * Keeps the document's preview up to date: asks the server for it shortly
 * after the server has confirmed the latest change. Every document has a
 * canvas, so every document has a picture to render.
 */
export function usePreviewLoading(documentId: string, enabled: boolean): void {
  const session = useAppStore((state) => state.documents[documentId])
  const settled = session !== undefined && session.pending.length === 0
  const revision = session?.confirmed.revision

  // biome-ignore lint/correctness/useExhaustiveDependencies: the revision is what makes the preview ask again
  useEffect(() => {
    if (!enabled || !settled) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void refreshPreview(documentId, controller.signal)
    }, PREVIEW_DELAY_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [documentId, enabled, settled, revision])
}

/** What a document looks like after its pipeline. Undefined until the document has loaded. */
export function usePreview(documentId: string): PipelinePreview | undefined {
  const session = useAppStore((state) => state.documents[documentId])
  const current = useAppStore((state) => state.previews[documentId])

  return useMemo(() => {
    if (!session) return undefined
    const pipeline = shownPipeline(session)
    const source = activeSource(pipeline, session.confirmed.sources)
    const rendered =
      current?.key === undefined
        ? undefined
        : previewImageUrl(documentId, current.key)
    const original =
      source === undefined ? undefined : sourceImageUrl(source.id)
    return {
      document: session.confirmed,
      pipeline,
      source,
      imageUrl: rendered,
      originalUrl: original,
      status: current?.status ?? PreviewStatus.Rendering,
      error: current?.error,
      pending: current?.pendingStepIds ?? [],
      problems: current?.problems ?? [],
    }
  }, [session, current, documentId])
}
