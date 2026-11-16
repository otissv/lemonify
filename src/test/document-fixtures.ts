import type { Mock } from 'vitest'

import type { AiCatalogues } from '@/features/ai/ai-defaults'
import { AiOutput, AiToolId, WorkerPool } from '@/features/ai/ai-tools'
import type { AiToolSummary } from '@/features/ai/ai-tools'
import type { DocumentView, SourceSummary } from '@/features/documents/document'
import { applyChange } from '@/features/pipeline/document-change'
import type { DocumentChange } from '@/features/pipeline/document-change'
import { createLayerStep } from '@/features/pipeline/pipeline'
import type { LayerStep, PipelineStep } from '@/features/pipeline/pipeline'
import { useAppStore } from '@/store/app-store'

export const DOCUMENT_ID = '6f1c6c4e-0f43-4a8f-9a57-2d2f0f8f2b11'

export const AI_TOOLS_OFFERED: ReadonlyArray<AiToolSummary> = [
  {
    id: AiToolId.Upscale,
    label: 'Upscale',
    pool: WorkerPool.Gpu,
    output: AiOutput.Image,
  },
]

export const AI_CATALOGUES: AiCatalogues = [
  {
    tool: AiToolId.Upscale,
    catalogue: {
      defaultModel: 'siax',
      models: [
        {
          name: 'siax',
          category: 'upscale',
          description: 'NMKD Siax',
          scales: [2, 3, 4],
          noise: null,
        },
        {
          name: 'waifu',
          category: 'upscale',
          description: 'Waifu2x CUnet',
          scales: [2, 4, 8],
          noise: [-1, 0, 1, 2, 3],
        },
      ],
    },
  },
]

/** The layer every document starts with, which sets its canvas, with an id that stays the same between calls. */
export function baseLayer(sourceId: string): LayerStep {
  return {
    ...createLayerStep(sourceId),
    id: '00000000-0000-4000-8000-0000000000aa',
  }
}

export function documentView(
  steps: ReadonlyArray<PipelineStep> = [],
  id: string = DOCUMENT_ID,
  name = 'one.png',
): DocumentView & { source: SourceSummary } {
  const source = {
    id: `source-${id}`,
    fileName: name,
    mediaType: 'image/png',
    bytes: 100,
    width: 10,
    height: 10,
  }
  return {
    id,
    name,
    source,
    sources: [source],
    pipeline: { steps: [baseLayer(source.id), ...steps] },
    revision: 0,
    canUndo: false,
    canRedo: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/** Puts a document in the editor as if the server had just sent it. */
export function loadDocumentIntoEditor(view: DocumentView): void {
  useAppStore.getState().confirmDocument(view, true)
}

/**
 * Makes `changeDocument` behave like the server: it applies the change to the
 * document it holds and answers with the new revision.
 */
export function echoChanges(changeDocument: Mock, start: DocumentView): void {
  let current = start
  changeDocument.mockImplementation(
    ({ data }: { data: { change: DocumentChange } }) => {
      current = {
        ...current,
        pipeline: applyChange(current.pipeline, data.change),
        revision: current.revision + 1,
        canUndo: true,
      }
      return Promise.resolve(current)
    },
  )
}
