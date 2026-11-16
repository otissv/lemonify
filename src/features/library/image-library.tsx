import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { SourceSummary } from '@/features/documents/document'
import { sourceImageUrl } from '@/features/documents/image-urls'
import {
  SourcesStatus,
  useSourcesStore,
} from '@/features/workflows/sources-store'
import { errorMessage } from '@/lib/error-message'

const DELETE_FAILED = 'The image could not be deleted.'

interface ImageLibraryProps {
  /** Called with the image the person clicked. */
  onChoose: (source: SourceSummary) => void
}

/**
 * The images the person has uploaded, as thumbnails to choose from, newest
 * first. It reads the list again each time it is shown, and lets an image
 * that nothing uses be deleted. What choosing an image does is up to the
 * caller: open it, insert it, replace with it.
 */
export function ImageLibrary({
  onChoose,
}: ImageLibraryProps): React.JSX.Element {
  const sources = useSourcesStore((state) => state.sources)
  const status = useSourcesStore((state) => state.status)
  const loadError = useSourcesStore((state) => state.error)
  const load = useSourcesStore((state) => state.load)
  const remove = useSourcesStore((state) => state.remove)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  async function handleDelete(source: SourceSummary): Promise<void> {
    setDeleteError(null)
    try {
      await remove(source.id)
    } catch (caught) {
      setDeleteError(errorMessage(caught, DELETE_FAILED))
    }
  }

  const error = deleteError ?? loadError
  const empty =
    status === SourcesStatus.Ready && sources.length === 0 && error === null

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-body-md text-destructive">
          {error}
        </p>
      )}
      {empty && (
        <p role="status" className="text-body-md text-muted-foreground">
          Your library is empty.
        </p>
      )}
      <ul
        aria-label="Library"
        className="grid max-h-96 grid-cols-3 gap-3 overflow-y-auto"
      >
        {sources.map((source) => (
          <li key={source.id} className="flex flex-col gap-1">
            <button
              type="button"
              aria-label={`Choose ${source.fileName}`}
              className="overflow-hidden rounded-md border border-border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={() => {
                onChoose(source)
              }}
            >
              <img
                src={sourceImageUrl(source.id)}
                alt=""
                loading="lazy"
                className="aspect-square w-full object-cover"
              />
            </button>
            <span className="truncate text-caption">{source.fileName}</span>
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Delete ${source.fileName}`}
              onClick={() => void handleDelete(source)}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
