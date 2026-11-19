import { useEffect, useMemo } from 'react'

import type { DocumentView, SourceSummary } from '@/features/documents/document'
import { refreshPreview } from '@/features/documents/document-render-sync'
import type { StepProblem } from '@/features/documents/document-render'
import { shownPipeline } from '@/features/pipeline/pipeline-session'
import {
  previewImageUrl,
  sourceImageUrl,
} from '@/features/documents/image-urls'
import { originalSourceId } from '@/features/pipeline/pipeline'
import type { Pipeline } from '@/features/pipeline/pipeline'
import { viewedStepId } from '@/features/overlay/viewed-step'
import { documentSession, usePipelineStore } from '@/store/pipeline-store'
import { useUiStore } from '@/store/ui-store'
import { PreviewStatus } from '@/features/documents/document-render'
import type { PictureSize } from '@/features/documents/document-render'

/** How long edits settle before the preview is asked for, so a burst of changes renders once. */
export const PREVIEW_DELAY_MS = 120

export interface PipelinePreview {
  document: DocumentView
  pipeline: Pipeline
  /** The image of the first image layer that is on: the document's original. Undefined when there is none. */
  source: SourceSummary | undefined
  /** The rendered picture. Undefined until the first render is ready. */
  imageUrl: string | undefined
  /** The rendered picture's size in its own pixels, which the preview may have shrunk to be shown. Undefined until the first render is ready. */
  size: PictureSize | undefined
  /** The step the rendered picture is the one before, or undefined when it is the whole document. */
  beforeStepId: string | undefined
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
 * after the server has confirmed the latest change, and again when the
 * selected step changes to or from one a tool draws on, since the canvas then
 * shows the picture before that step. Every document has a canvas, so every
 * document has a picture to render.
 */
export function usePreviewLoading(documentId: string, enabled: boolean): void {
  const session = usePipelineStore((state) =>
    documentSession(state, documentId),
  )
  const selectedId = useUiStore((state) => state.selectedSteps[documentId])
  const settled = session !== undefined && session.pending.length === 0
  const revision = session?.confirmed.revision
  const viewed =
    session === undefined
      ? undefined
      : viewedStepId(selectedId, session.confirmed.pipeline)

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
  }, [documentId, enabled, settled, revision, viewed])
}

/** What a document looks like after its pipeline. Undefined until the document has loaded. */
export function usePreview(documentId: string): PipelinePreview | undefined {
  const session = usePipelineStore((state) =>
    documentSession(state, documentId),
  )
  const current = usePipelineStore((state) => state.previews[documentId])

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
      size: current?.size,
      beforeStepId: current?.beforeStepId,
      originalUrl: original,
      status: current?.status ?? PreviewStatus.Rendering,
      error: current?.error,
      pending: current?.pendingStepIds ?? [],
      problems: current?.problems ?? [],
    }
  }, [session, current, documentId])
}
