import { useEffect, useState } from 'react'

import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { SplitButton } from '@/components/ui/split-button'
import type { SourceSummary } from '@/features/documents/document'
import {
  SourcesStatus,
  useSourcesStore,
} from '@/features/workflows/sources-store'
import { ImageLibraryDialog } from '@/features/library/image-library-dialog'
import { UploadButton } from '@/features/workflows/upload-button'

interface ImagePickerProps {
  /** Names the controls, e.g. "Operand". */
  label: string
  /** Called with the id of the Source chosen or uploaded. */
  onPick: (sourceId: string) => void
  /** What the upload button says; "Upload <label>…" when left out. */
  uploadLabel?: string
}

const MAX_RECENT_IMAGES = 5

/** Chooses another image: a new upload, one of the five images uploaded most recently, or any image from the library. */
export function ImagePicker({
  label,
  onPick,
  uploadLabel = `Upload ${label.toLowerCase()}…`,
}: ImagePickerProps): React.JSX.Element {
  const sources = useSourcesStore((state) => state.sources)
  const status = useSourcesStore((state) => state.status)
  const load = useSourcesStore((state) => state.load)
  const [libraryOpen, setLibraryOpen] = useState(false)

  useEffect(() => {
    if (status === SourcesStatus.Idle) void load()
  }, [status, load])

  function handleUploaded(uploaded: ReadonlyArray<SourceSummary>): void {
    for (const source of uploaded) onPick(source.id)
  }

  async function handleLibraryChoice(
    chosen: ReadonlyArray<SourceSummary>,
  ): Promise<void> {
    const [first] = chosen
    if (first !== undefined) onPick(first.id)
  }

  return (
    <div className="flex flex-col gap-2">
      <SplitButton
        label={label}
        menuLabel={`Choose an image for ${label.toLowerCase()}`}
        items={[
          ...sources.slice(0, MAX_RECENT_IMAGES).map((source) => (
            <DropdownMenuItem
              key={source.id}
              onSelect={() => onPick(source.id)}
            >
              {source.fileName}
            </DropdownMenuItem>
          )),
          <DropdownMenuItem
            key="library"
            onSelect={() => {
              setLibraryOpen(true)
            }}
          >
            Choose from library…
          </DropdownMenuItem>,
        ]}
      >
        <UploadButton
          label={uploadLabel}
          className="min-w-0 flex-1"
          buttonClassName="w-full flex-1 rounded-r-none"
          onUploaded={handleUploaded}
        />
      </SplitButton>
      <ImageLibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        title="Library"
        description="Choose an image from your library."
        onChoose={handleLibraryChoice}
      />
    </div>
  )
}
