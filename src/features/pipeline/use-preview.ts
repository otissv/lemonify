import { useEffect, useMemo } from 'react'

import type { DocumentView, SourceSummary } from '@/features/documents/document'
import { refreshPreview } from '@/features/documents/document-render-sync'
import type { StepProblem } from '@/features/documents/document-render'
import { shownPipeline } from '@/features/documents/document-session'
import {
  previewImageUrl,
  sourceImageUrl,
} from '@/features/documents/image-urls'
import { firstSourceStep, hasEdits } from '@/features/pipeline/pipeline'
import type { Pipeline } from '@/features/pipeline/pipeline'
import { PreviewStatus, useAppStore } from '@/store/app-store'

/** How long edits settle before the preview is asked for, so a burst of changes renders once. */
export const PREVIEW_DELAY_MS = 120

export interface PipelinePreview {
  document: DocumentView
  pipeline: Pipeline
  /** The document's own image. Undefined when it is gone. */
  source: SourceSummary | undefined
  /** The picture to show: the rendered result, or the image itself while there are no edits. Undefined without an image. */
  imageUrl: string | undefined
  /** The image as opened, before any edit. */
  originalUrl: string | undefined
  status: PreviewStatus
  error: string | undefined
  /** Enabled AI steps that still need running. */
  pending: ReadonlyArray<string>
  /** Steps left out of the picture, with why. */
  problems: ReadonlyArray<StepProblem>
}

/** The document's own image, as far as the document's images are known. */
export function activeSource(
  pipeline: Pipeline,
  sources: ReadonlyArray<SourceSummary>,
): SourceSummary | undefined {
  const first = firstSourceStep(pipeline)
  return sources.find(({ id }) => id === first?.sourceId)
}

/**
 * Keeps the document's preview up to date: asks the server for it shortly
 * after the server has confirmed the latest change, as long as the pipeline has
 * edits and an image (without edits, the image itself is what is shown).
 */
export function usePreviewLoading(documentId: string, enabled: boolean): void {
  const session = useAppStore((state) => state.documents[documentId])
  const settled = session !== undefined && session.pending.length === 0
  const revision = session?.confirmed.revision
  const pipeline = session?.confirmed.pipeline
  const hasSteps =
    pipeline !== undefined &&
    hasEdits(pipeline) &&
    activeSource(pipeline, session?.confirmed.sources ?? []) !== undefined

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
    const source = activeSource(pipeline, session.confirmed.sources)
    const edited = hasEdits(pipeline) && source !== undefined
    const rendered =
      edited && current?.key !== undefined
        ? previewImageUrl(documentId, current.key)
        : undefined
    const original =
      source === undefined ? undefined : sourceImageUrl(source.id)
    return {
      document: session.confirmed,
      pipeline,
      source,
      imageUrl: rendered ?? original,
      originalUrl: original,
      status: current?.status ?? PreviewStatus.Rendering,
      error: current?.error,
      pending: edited ? (current?.pendingStepIds ?? []) : [],
      problems: edited ? (current?.problems ?? []) : [],
    }
  }, [session, current, documentId])
}
