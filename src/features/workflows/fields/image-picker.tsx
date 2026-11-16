import { useContext, useEffect } from 'react'

import { DropdownButton } from '@/components/ui/dropdown-button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { SplitButton } from '@/components/ui/split-button'
import type { SourceSummary } from '@/features/documents/document'
import {
  SourcesStatus,
  useSourcesStore,
} from '@/features/workflows/sources-store'
import { ImageChoicesContext } from '@/features/workflows/fields/image-choices'
import { UploadButton } from '@/features/workflows/upload-button'

interface ImagePickerProps {
  /** Names the controls, e.g. "Operand". */
  label: string
  /** Called with the id of the Source chosen or uploaded. */
  onPick: (sourceId: string) => void
}

const NO_OPEN_IMAGES =
  'Add an Open image step before this one to use another image.'

/**
 * Chooses another image: one of your uploaded images, or a new upload. Where
 * the editor limits the choice, only those images are offered.
 */
export function ImagePicker({
  label,
  onPick,
}: ImagePickerProps): React.JSX.Element {
  const choices = useContext(ImageChoicesContext)
  const uploaded = useSourcesStore((state) => state.sources)
  const sources = choices ?? uploaded
  const status = useSourcesStore((state) => state.status)
  const load = useSourcesStore((state) => state.load)

  useEffect(() => {
    if (choices === undefined && status === SourcesStatus.Idle) void load()
  }, [choices, status, load])

  function handleUploaded(uploaded: ReadonlyArray<SourceSummary>): void {
    for (const source of uploaded) onPick(source.id)
  }

  const menuLabel = `Use ${choices === undefined ? 'an uploaded' : 'an opened'} image for ${label.toLowerCase()}`
  const items = sources.map((source) => (
    <DropdownMenuItem key={source.id} onSelect={() => onPick(source.id)}>
      {source.fileName}
    </DropdownMenuItem>
  ))

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
            label={`Upload ${label.toLowerCase()}…`}
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
    </div>
  )
}
