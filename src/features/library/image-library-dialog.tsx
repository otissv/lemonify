import { useState } from 'react'

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
import { ImageLibrary } from '@/features/library/image-library'
import { UploadButton } from '@/features/workflows/upload-button'
import { errorMessage } from '@/lib/error-message'

const CHOICE_FAILED = 'That image could not be used.'

interface ImageLibraryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Says what choosing an image will do, e.g. "Insert image". */
  title: string
  description: string
  /** What to do with the images chosen (one from the library, or those just uploaded). The dialog closes when it finishes, and stays open with the reason when it throws. */
  onChoose: (sources: ReadonlyArray<SourceSummary>) => Promise<void>
  /** When given, the dialog also offers uploading from this computer, under this name. */
  uploadLabel?: string
}

/** The library in a dialog, for choosing an image (or uploading a new one) to open, insert or replace with. */
export function ImageLibraryDialog({
  open,
  onOpenChange,
  title,
  description,
  onChoose,
  uploadLabel,
}: ImageLibraryDialogProps): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)

  async function handleChoose(
    sources: ReadonlyArray<SourceSummary>,
  ): Promise<void> {
    setError(null)
    try {
      await onChoose(sources)
      onOpenChange(false)
    } catch (caught) {
      setError(errorMessage(caught, CHOICE_FAILED))
    }
  }

  function handleOpenChange(next: boolean): void {
    if (!next) setError(null)
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {uploadLabel !== undefined && (
          <UploadButton
            label={uploadLabel}
            className="items-start"
            onUploaded={(sources) => void handleChoose(sources)}
          />
        )}
        {error && (
          <p role="alert" className="text-body-md text-destructive">
            {error}
          </p>
        )}
        <ImageLibrary onChoose={(source) => void handleChoose([source])} />
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
