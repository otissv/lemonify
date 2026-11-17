import { useCallback } from 'react'

import { CanvasForm } from '@/features/documents/canvas-form'
import { applyEdit } from '@/features/pipeline/pipeline-sync'
import type { Canvas } from '@/features/pipeline/canvas'
import { usePreview } from '@/features/pipeline/use-preview'
import { isLayerStep } from '@/features/pipeline/layer-kinds'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import { formatSize } from '@/lib/format-size'

interface DocumentInfoProps {
  documentId: string
}

interface Detail {
  term: string
  value: string
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function isSharp(step: PipelineStep): boolean {
  return step.kind === PipelineStepKind.Sharp
}

function isAi(step: PipelineStep): boolean {
  return step.kind === PipelineStepKind.Ai
}

function countOf(
  steps: ReadonlyArray<PipelineStep>,
  matches: (step: PipelineStep) => boolean,
): number {
  let count = 0
  for (const step of steps) {
    if (matches(step)) count += 1
  }
  return count
}

function typeOf(mediaType: string): string {
  return mediaType.split('/').at(1)?.toUpperCase() ?? mediaType
}

interface CanvasSectionProps {
  documentId: string
  canvas: Canvas
}

/** The canvas the steps are drawn on, to change as one undoable edit. Keyed by its value, so it shows what an undo or another tab changed. */
function CanvasSection({
  documentId,
  canvas,
}: CanvasSectionProps): React.JSX.Element {
  const handleSubmit = useCallback(
    (next: Canvas): void => {
      void applyEdit(documentId, { type: 'set-canvas', canvas: next })
    },
    [documentId],
  )

  return (
    <section aria-label="Canvas" className="flex flex-col gap-2">
      <h3 className="text-caption font-medium text-muted-foreground">Canvas</h3>
      <CanvasForm
        key={`${canvas.width}x${canvas.height}-${canvas.background}`}
        initial={canvas}
        submitLabel="Change canvas"
        onSubmit={handleSubmit}
      />
    </section>
  )
}

/** What the document is, for the Document tab: its image, how many steps of each kind it has, and when it was made and changed. */
export function DocumentInfo({
  documentId,
}: DocumentInfoProps): React.JSX.Element | null {
  const preview = usePreview(documentId)
  if (!preview) return null
  const { document } = preview
  const { source, pipeline } = document
  const { steps } = pipeline
  const details: Detail[] = [
    { term: 'Name', value: document.name },
    {
      term: 'Canvas size',
      value: `${pipeline.canvas.width} × ${pipeline.canvas.height} px`,
    },
    { term: 'Background', value: pipeline.canvas.background },
    { term: 'Original image', value: source?.fileName ?? 'None' },
  ]
  if (source) {
    details.push(
      { term: 'Image size', value: `${source.width} × ${source.height} px` },
      { term: 'Image type', value: typeOf(source.mediaType) },
      { term: 'File size', value: formatSize(source.bytes) },
    )
  }
  details.push(
    { term: 'Steps', value: String(steps.length) },
    { term: 'Layers', value: String(countOf(steps, isLayerStep)) },
    { term: 'Effects', value: String(countOf(steps, isSharp)) },
    { term: 'AI steps', value: String(countOf(steps, isAi)) },
    {
      term: 'Created',
      value: DATE_FORMAT.format(new Date(document.createdAt)),
    },
    {
      term: 'Last changed',
      value: DATE_FORMAT.format(new Date(document.updatedAt)),
    },
    { term: 'Revision', value: String(document.revision) },
    { term: 'Id', value: document.id },
  )

  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="text-title-sm">Document</h2>
      <CanvasSection documentId={documentId} canvas={pipeline.canvas} />
      <dl aria-label="Document details" className="flex flex-col gap-2">
        {details.map(({ term, value }) => (
          <div key={term} className="flex flex-col">
            <dt className="text-caption text-muted-foreground">{term}</dt>
            <dd className="break-words text-body-md">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
