import { formatSize } from '@/lib/format-size'
import { RiAddLine, RiCloseLine } from '@remixicon/react'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import type { SourceSummary } from '@/features/documents/document'
import {
  SourcesStatus,
  sourceFileName,
  useSourcesStore,
} from '@/features/workflows/sources-store'
import { UploadButton } from '@/features/workflows/upload-button'

interface InputSourcesPanelProps {
  sourceIds: ReadonlyArray<string>
  onAdd: (sourceIds: ReadonlyArray<string>) => void
  onRemove: (sourceId: string) => void
}

/** The images the workflow runs on: choose from your uploaded images, or upload more. */
export function InputSourcesPanel({
  sourceIds,
  onAdd,
  onRemove,
}: InputSourcesPanelProps): React.JSX.Element {
  const sources = useSourcesStore((state) => state.sources)
  const status = useSourcesStore((state) => state.status)
  const error = useSourcesStore((state) => state.error)
  const load = useSourcesStore((state) => state.load)

  useEffect(() => {
    if (status === SourcesStatus.Idle) void load()
  }, [status, load])

  function handleUploaded(uploaded: ReadonlyArray<SourceSummary>): void {
    onAdd(uploaded.map(({ id }) => id))
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-body-md text-muted-foreground">
        The images this workflow runs on. Choose as many as you like to process
        them together.
      </p>
      <UploadButton label="Upload images…" onUploaded={handleUploaded} />
      {error && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
      <ChosenList sourceIds={sourceIds} sources={sources} onRemove={onRemove} />
      <Available
        sourceIds={sourceIds}
        sources={sources}
        loading={status === SourcesStatus.Loading}
        onAdd={onAdd}
      />
    </div>
  )
}

interface ChosenListProps {
  sourceIds: ReadonlyArray<string>
  sources: ReadonlyArray<SourceSummary>
  onRemove: (sourceId: string) => void
}

function ChosenList({
  sourceIds,
  sources,
  onRemove,
}: ChosenListProps): React.JSX.Element {
  if (sourceIds.length === 0) {
    return <p className="text-caption text-muted-foreground">No images yet.</p>
  }
  return (
    <ul aria-label="Images" className="flex flex-col">
      {sourceIds.map((id) => {
        const name = sourceFileName(sources, id)
        const source = sources.find((candidate) => candidate.id === id)
        return (
          <li key={id} className="flex items-center justify-between gap-2 py-1">
            <span className="min-w-0">
              <span className="block truncate text-body-md">{name}</span>
              {source && (
                <span className="text-caption text-muted-foreground">
                  {formatSize(source.bytes)}
                </span>
              )}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${name}`}
              onClick={() => onRemove(id)}
            >
              <RiCloseLine aria-hidden="true" />
            </Button>
          </li>
        )
      })}
    </ul>
  )
}

interface AvailableProps {
  sourceIds: ReadonlyArray<string>
  sources: ReadonlyArray<SourceSummary>
  loading: boolean
  onAdd: (sourceIds: ReadonlyArray<string>) => void
}

function Available({
  sourceIds,
  sources,
  loading,
  onAdd,
}: AvailableProps): React.JSX.Element | null {
  const unused = sources.filter(({ id }) => !sourceIds.includes(id))
  if (unused.length === 0) {
    return loading ? (
      <p role="status" className="text-caption text-muted-foreground">
        Loading your images…
      </p>
    ) : null
  }
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-caption font-medium text-muted-foreground">
        Your other images
      </h3>
      <ul aria-label="Your other images" className="flex flex-col">
        {unused.map((source) => (
          <li key={source.id} className="flex items-center gap-2 py-1">
            <span className="min-w-0 flex-1 truncate text-body-md">
              {source.fileName}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Add ${source.fileName}`}
              onClick={() => onAdd([source.id])}
            >
              <RiAddLine aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
