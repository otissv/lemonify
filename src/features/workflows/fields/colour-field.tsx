import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { ControlProps } from '@/features/workflows/fields/control-props'
import { ColourPicker } from '@/features/workflows/fields/colour-picker'
import {
  formatColour,
  parseColour,
} from '@/features/workflows/fields/colour-value'
import type { Rgba } from '@/features/workflows/fields/colour-value'

const BLACK: Rgba = { r: 0, g: 0, b: 0, alpha: 1 }
const CHECKER =
  'repeating-conic-gradient(#808080 0% 25%, #c0c0c0 0% 50%) 50% / 8px 8px'

function textOf(value: ControlProps['value']): string {
  if (value === undefined) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function swatchBackground(colour: Rgba | undefined): string {
  if (!colour) return CHECKER
  const fill = `rgba(${colour.r}, ${colour.g}, ${colour.b}, ${colour.alpha})`
  return `linear-gradient(${fill}, ${fill}), ${CHECKER}`
}

/** A colour: a swatch that opens the picker, and the colour as text (any CSS colour). */
export function ColourControl({
  field,
  value,
  problem,
  onChange,
  id,
  describedBy,
}: ControlProps): React.JSX.Element {
  const colour = parseColour(value)
  const [opened, setOpened] = useState<Rgba | undefined>(undefined)

  function handleOpenChange(open: boolean): void {
    setOpened(open ? colour : undefined)
  }

  function handleText(event: React.ChangeEvent<HTMLInputElement>): void {
    const next = event.target.value
    onChange(field.name, next === '' ? undefined : next)
  }

  function handlePick(picked: Rgba): void {
    onChange(field.name, formatColour(picked))
  }

  function handleClear(): void {
    onChange(field.name, undefined)
  }

  return (
    <div className="flex items-center gap-2">
      <Popover onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${field.label} picker`}
            className="size-9 shrink-0 cursor-pointer rounded-md border border-input p-1 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span
              className="block size-full rounded-sm"
              style={{ background: swatchBackground(colour) }}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72" aria-label={`${field.label} picker`}>
          <ColourPicker
            colour={colour ?? BLACK}
            original={opened}
            onChange={handlePick}
          />
        </PopoverContent>
      </Popover>
      <Input
        id={id}
        required={field.required}
        placeholder="#rrggbb or a colour name"
        value={textOf(value)}
        aria-invalid={problem ? true : undefined}
        aria-describedby={describedBy}
        onChange={handleText}
      />
      {value !== undefined && !field.required && (
        <Button
          variant="ghost"
          size="xs"
          aria-label={`Clear ${field.label}`}
          onClick={handleClear}
        >
          Clear
        </Button>
      )}
    </div>
  )
}
