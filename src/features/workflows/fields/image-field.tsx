import { RiCloseLine } from '@remixicon/react'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { useImageNames } from '@/features/workflows/fields/image-names'
import type { ControlProps } from '@/features/workflows/fields/control-props'
import { ImagePicker } from '@/features/workflows/fields/image-picker'

const IdListSchema = z.array(z.string().min(1))

interface ChosenProps {
  ids: ReadonlyArray<string>
  label: string
  onRemove: (id: string) => void
}

function Chosen({ ids, label, onRemove }: ChosenProps): React.JSX.Element {
  const nameOf = useImageNames()
  if (ids.length === 0)
    return (
      <p className="text-caption text-muted-foreground">No image chosen.</p>
    )
  return (
    <ul aria-label={label} className="flex flex-col gap-1">
      {ids.map((id) => (
        <li key={id} className="flex items-center justify-between gap-2">
          <span className="truncate text-body-md">{nameOf(id)}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove ${nameOf(id)}`}
            onClick={() => {
              onRemove(id)
            }}
          >
            <RiCloseLine aria-hidden="true" />
          </Button>
        </li>
      ))}
    </ul>
  )
}

/** One other image, for example the operand of a boolean step. */
export function ImageControl({
  field,
  value,
  onChange,
}: ControlProps): React.JSX.Element {
  const id = typeof value === 'string' ? value : undefined

  function handlePick(picked: string): void {
    onChange(field.name, picked)
  }

  function handleRemove(): void {
    onChange(field.name, undefined)
  }

  return (
    <div className="flex flex-col gap-2">
      <Chosen
        ids={id ? [id] : []}
        label={field.label}
        onRemove={handleRemove}
      />
      <ImagePicker label={field.label} onPick={handlePick} />
    </div>
  )
}

/** One or several other images, such as the channels of a join channel step. */
export function ImagesControl({
  field,
  value,
  onChange,
}: ControlProps): React.JSX.Element {
  const parsed = IdListSchema.safeParse(
    typeof value === 'string' ? [value] : value,
  )
  const ids = parsed.success ? parsed.data : []

  function handlePick(picked: string): void {
    onChange(field.name, [...ids, picked])
  }

  function handleRemove(removed: string): void {
    const rest = ids.filter((id) => id !== removed)
    onChange(field.name, rest.length === 0 ? undefined : rest)
  }

  return (
    <div className="flex flex-col gap-2">
      <Chosen ids={ids} label={field.label} onRemove={handleRemove} />
      <ImagePicker label="image" onPick={handlePick} />
    </div>
  )
}
