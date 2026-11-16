import { RiUploadLine } from '@remixicon/react'
import { useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { SourceSummary } from '@/features/documents/document'
import { useSourcesStore } from '@/features/workflows/sources-store'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/lib/error-message'

interface UploadButtonProps {
  label: string
  /** Extra classes for the button, for example to join it to a neighbour. */
  buttonClassName?: string
  /** Extra classes for the wrapper around the button and its error message. */
  className?: string
  onUploaded: (sources: ReadonlyArray<SourceSummary>) => void
}

const UPLOAD_FAILED = 'The image could not be uploaded.'

/** Uploads one or more images from this computer as Sources, and says why one failed. */
export function UploadButton({
  label,
  buttonClassName,
  className,
  onUploaded,
}: UploadButtonProps): React.JSX.Element {
  const upload = useSourcesStore((state) => state.upload)
  const input = useRef<HTMLInputElement>(null)
  const errorId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleClick(): void {
    input.current?.click()
  }

  async function handleChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    if (files.length === 0) return
    setBusy(true)
    setError(null)
    const uploaded: SourceSummary[] = []
    try {
      for (const file of files) uploaded.push(await upload(file))
    } catch (caught) {
      setError(errorMessage(caught, UPLOAD_FAILED))
    } finally {
      setBusy(false)
      if (uploaded.length > 0) onUploaded(uploaded)
    }
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-label={`${label} file`}
        onChange={(event) => void handleChange(event)}
      />
      <Button
        variant="secondary"
        size="sm"
        className={buttonClassName}
        disabled={busy}
        aria-describedby={error ? errorId : undefined}
        onClick={handleClick}
      >
        <RiUploadLine aria-hidden="true" />
        {busy ? 'Uploading…' : label}
      </Button>
      {error && (
        <p id={errorId} role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
