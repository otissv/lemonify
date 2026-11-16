import { useContext, useEffect, useState } from 'react'

import { DropdownButton } from '@/components/ui/dropdown-button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { SplitButton } from '@/components/ui/split-button'
import type { SourceSummary } from '@/features/documents/document'
import {
  SourcesStatus,
  useSourcesStore,
} from '@/features/workflows/sources-store'
import { ImageLibraryDialog } from '@/features/library/image-library-dialog'
import { ImageChoicesContext } from '@/features/workflows/fields/image-choices'
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

const NO_OPEN_IMAGES =
  'Add an Open image step before this one to use another image.'

/**
 * Chooses another image: a new upload, one of the five images uploaded most
 * recently, or any image from the library. Where the editor limits the
 * choice, only those images are offered.
 */
export function ImagePicker({
  label,
  onPick,
  uploadLabel = `Upload ${label.toLowerCase()}…`,
}: ImagePickerProps): React.JSX.Element {
  const choices = useContext(ImageChoicesContext)
  const uploaded = useSourcesStore((state) => state.sources)
  const sources = choices ?? uploaded
  const status = useSourcesStore((state) => state.status)
  const load = useSourcesStore((state) => state.load)
  const [libraryOpen, setLibraryOpen] = useState(false)

  useEffect(() => {
    if (choices === undefined && status === SourcesStatus.Idle) void load()
  }, [choices, status, load])

  function handleUploaded(uploaded: ReadonlyArray<SourceSummary>): void {
    for (const source of uploaded) onPick(source.id)
  }

  const menuLabel =
    choices === undefined
      ? `Choose an image for ${label.toLowerCase()}`
      : `Use an opened image for ${label.toLowerCase()}`
  const listed =
    choices === undefined ? sources.slice(0, MAX_RECENT_IMAGES) : sources
  const items = listed.map((source) => (
    <DropdownMenuItem key={source.id} onSelect={() => onPick(source.id)}>
      {source.fileName}
    </DropdownMenuItem>
  ))
  if (choices === undefined) {
    items.push(
      <DropdownMenuItem
        key="library"
        onSelect={() => {
          setLibraryOpen(true)
        }}
      >
        Choose from library…
      </DropdownMenuItem>,
    )
  }

  async function handleLibraryChoice(
    chosen: ReadonlyArray<SourceSummary>,
  ): Promise<void> {
    const [first] = chosen
    if (first !== undefined) onPick(first.id)
  }

  if (choices !== undefined && choices.length === 0) {
    return (
      <p className="text-caption text-muted-foreground">{NO_OPEN_IMAGES}</p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {choices === undefined ? (
        <SplitButton label={label} menuLabel={menuLabel} items={items}>
          <UploadButton
            label={uploadLabel}
            className="min-w-0 flex-1"
            buttonClassName="w-full flex-1 rounded-r-none"
            onUploaded={handleUploaded}
          />
        </SplitButton>
      ) : (
        <DropdownButton label="Opened images" ariaLabel={menuLabel}>
          {items}
        </DropdownButton>
      )}
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
