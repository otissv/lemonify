import { useId } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { PictureSize } from '@/features/pipeline/canvas'

interface SizeFieldsProps {
  size: PictureSize
  disabled: boolean
  onChange: (size: PictureSize) => void
}

/** A width and height in pixels, for a new document whose source does not give it a size. */
export function SizeFields({
  size,
  disabled,
  onChange,
}: SizeFieldsProps): React.JSX.Element {
  const widthId = useId()
  const heightId = useId()

  function handleWidth(event: React.ChangeEvent<HTMLInputElement>): void {
    onChange({ ...size, width: Number(event.target.value) })
  }

  function handleHeight(event: React.ChangeEvent<HTMLInputElement>): void {
    onChange({ ...size, height: Number(event.target.value) })
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor={widthId}>Width</Label>
        <Input
          id={widthId}
          type="number"
          min={1}
          value={size.width}
          disabled={disabled}
          onChange={handleWidth}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={heightId}>Height</Label>
        <Input
          id={heightId}
          type="number"
          min={1}
          value={size.height}
          disabled={disabled}
          onChange={handleHeight}
        />
      </div>
    </div>
  )
}
