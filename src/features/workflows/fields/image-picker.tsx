import { useEffect } from 'react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { SourceSummary } from '@/features/documents/document'
import {
  SourcesStatus,
  useSourcesStore,
} from '@/features/workflows/sources-store'
import { UploadButton } from '@/features/workflows/upload-button'

interface ImagePickerProps {
  /** Names the controls, e.g. "Operand". */
  label: string
  /** Called with the id of the Source chosen or uploaded. */
  onPick: (sourceId: string) => void
}

/** Two ways to choose another image: one of your uploaded images, or a new upload. */
export function ImagePicker({
  label,
  onPick,
}: ImagePickerProps): React.JSX.Element {
  const sources = useSourcesStore((state) => state.sources)
  const status = useSourcesStore((state) => state.status)
  const load = useSourcesStore((state) => state.load)

  useEffect(() => {
    if (status === SourcesStatus.Idle) void load()
  }, [status, load])

  function handleUploaded(uploaded: ReadonlyArray<SourceSummary>): void {
    for (const source of uploaded) onPick(source.id)
  }

  return (
    <div className="flex flex-col gap-2">
      <UploadButton
        label={`Upload ${label.toLowerCase()}…`}
        onUploaded={handleUploaded}
      />
      {sources.length > 0 && (
        <Select value="" onValueChange={onPick}>
          <SelectTrigger
            aria-label={`Use an uploaded image for ${label.toLowerCase()}`}
            className="min-w-0"
          >
            <SelectValue placeholder="Your images" />
          </SelectTrigger>
          <SelectContent>
            {sources.map((source) => (
              <SelectItem key={source.id} value={source.id}>
                {source.fileName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
