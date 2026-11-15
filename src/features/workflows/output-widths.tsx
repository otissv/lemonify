import { RiCloseLine } from '@remixicon/react'
import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  COMMON_WIDTHS,
  MAX_OUTPUT_WIDTH,
  MAX_OUTPUT_WIDTHS,
  withWidth,
  withoutWidth,
} from '@/features/workflows/output-settings'

interface OutputWidthsProps {
  widths: ReadonlyArray<number>
  onChange: (widths: Array<number>) => void
}

/** The widths one image is made at, for responsive images. */
export function OutputWidths({
  widths,
  onChange,
}: OutputWidthsProps): React.JSX.Element {
  const id = useId()
  const [draft, setDraft] = useState('')
  const full = widths.length >= MAX_OUTPUT_WIDTHS

  function handleDraftChange(event: React.ChangeEvent<HTMLInputElement>): void {
    setDraft(event.target.value)
  }

  function handleAdd(): void {
    const width = Number.parseInt(draft, 10)
    if (!(width > 0 && width <= MAX_OUTPUT_WIDTH)) return
    onChange(withWidth(widths, width))
    setDraft('')
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return
    event.preventDefault()
    handleAdd()
  }

  function handleAddCommon(): void {
    let next = [...widths]
    for (const width of COMMON_WIDTHS) next = withWidth(next, width)
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>New width</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_OUTPUT_WIDTH}
          placeholder="Pixels"
          value={draft}
          disabled={full}
          onChange={handleDraftChange}
          onKeyDown={handleKeyDown}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={full || draft === ''}
          onClick={handleAdd}
        >
          Add width
        </Button>
      </div>
      <Button
        variant="link"
        size="xs"
        disabled={full}
        onClick={handleAddCommon}
      >
        Add common sizes
      </Button>
      {widths.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          Add at least one width. Images narrower than a width are skipped for
          it.
        </p>
      ) : (
        <ul aria-label="Widths" className="flex flex-wrap gap-1">
          {widths.map((width) => (
            <li
              key={width}
              className="flex items-center gap-1 rounded-md border border-border py-0.5 pr-0.5 pl-2 text-caption"
            >
              {width}px
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${width}`}
                onClick={() => onChange(withoutWidth(widths, width))}
              >
                <RiCloseLine aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
