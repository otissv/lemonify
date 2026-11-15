import { useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { SourceSummary } from '@/features/documents/document'
import { createDocument } from '@/features/documents/document-functions'
import { sourceImageUrl } from '@/features/documents/image-urls'
import { deleteSource, listSources } from '@/features/sources/source-functions'
import { errorMessage } from '@/lib/error-message'

const LIST_FAILED = 'Your images could not be listed.'
const OPEN_FAILED = 'The image could not be opened.'
const DELETE_FAILED = 'The image could not be deleted.'

interface SourcePickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Picks one of the images already uploaded and opens it as a new document. */
export function SourcePickerDialog({
  open,
  onOpenChange,
}: SourcePickerDialogProps): React.JSX.Element {
  const navigate = useNavigate()
  const router = useRouter()
  const [sources, setSources] = useState<ReadonlyArray<SourceSummary>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setSources(await listSources())
    } catch (caught) {
      setError(errorMessage(caught, LIST_FAILED))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  async function handleChoose(source: SourceSummary): Promise<void> {
    setError(null)
    try {
      const document = await createDocument({ data: { sourceId: source.id } })
      await router.invalidate()
      onOpenChange(false)
      await navigate({ to: '/documents/$id', params: { id: document.id } })
    } catch (caught) {
      setError(errorMessage(caught, OPEN_FAILED))
    }
  }

  async function handleDelete(source: SourceSummary): Promise<void> {
    setError(null)
    try {
      await deleteSource({ data: { id: source.id } })
      await load()
    } catch (caught) {
      setError(errorMessage(caught, DELETE_FAILED))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Uploaded images</DialogTitle>
          <DialogDescription>
            Open a new document on an image you uploaded before.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-body-md text-destructive">
            {error}
          </p>
        )}
        {!loading && sources.length === 0 && error === null && (
          <p role="status" className="text-body-md text-muted-foreground">
            You have not uploaded any images yet.
          </p>
        )}
        <ul
          aria-label="Uploaded images"
          className="grid max-h-96 grid-cols-3 gap-3 overflow-y-auto"
        >
          {sources.map((source) => (
            <li key={source.id} className="flex flex-col gap-1">
              <button
                type="button"
                aria-label={`Open ${source.fileName}`}
                className="overflow-hidden rounded-md border border-border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onClick={() => void handleChoose(source)}
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
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary" size="sm">
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
