import { usePreview } from '@/features/pipeline/use-preview'
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

function countOf(
  steps: ReadonlyArray<PipelineStep>,
  kind: PipelineStep['kind'],
): number {
  let count = 0
  for (const step of steps) {
    if (step.kind === kind) count += 1
  }
  return count
}

function typeOf(mediaType: string): string {
  return mediaType.split('/').at(1)?.toUpperCase() ?? mediaType
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
    { term: 'Canvas image', value: source?.fileName ?? 'None' },
  ]
  if (source) {
    details.push(
      { term: 'Canvas size', value: `${source.width} × ${source.height} px` },
      { term: 'Canvas type', value: typeOf(source.mediaType) },
      { term: 'File size', value: formatSize(source.bytes) },
    )
  }
  details.push(
    { term: 'Steps', value: String(steps.length) },
    { term: 'Layers', value: String(countOf(steps, PipelineStepKind.Layer)) },
    { term: 'Effects', value: String(countOf(steps, PipelineStepKind.Sharp)) },
    { term: 'AI steps', value: String(countOf(steps, PipelineStepKind.Ai)) },
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
