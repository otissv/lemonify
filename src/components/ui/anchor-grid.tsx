import { useId } from 'react'

import { cn } from '@/lib/utils'

export interface AnchorPoint<Value extends string> {
  value: Value
  label: string
}

/** The nine points of a box, named as compass points, left to right and top to bottom. */
export const COMPASS_POINTS = [
  { value: 'northwest', label: 'Top left' },
  { value: 'north', label: 'Top' },
  { value: 'northeast', label: 'Top right' },
  { value: 'west', label: 'Left' },
  { value: 'centre', label: 'Centre' },
  { value: 'east', label: 'Right' },
  { value: 'southwest', label: 'Bottom left' },
  { value: 'south', label: 'Bottom' },
  { value: 'southeast', label: 'Bottom right' },
] as const satisfies ReadonlyArray<AnchorPoint<string>>

export type CompassPoint = (typeof COMPASS_POINTS)[number]['value']

interface AnchorGridProps<Value extends string> {
  /** The id of the element that names the grid. */
  labelledBy: string
  /** Nine points, left to right and top to bottom. */
  points: ReadonlyArray<AnchorPoint<Value>>
  /** The chosen point; none is chosen when it is undefined. */
  value: Value | undefined
  onChange: (value: Value) => void
  className?: string
}

/** Nine points laid out as the box they stand for, one of which can be chosen. It knows nothing about what the point is used for. */
export function AnchorGrid<Value extends string>({
  labelledBy,
  points,
  value,
  onChange,
  className,
}: AnchorGridProps<Value>): React.JSX.Element {
  const name = useId()

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      data-slot="anchor-grid"
      className={cn('grid w-28 grid-cols-3 gap-1', className)}
    >
      {points.map((point) => (
        <label key={point.value} title={point.label} className="block">
          <input
            type="radio"
            name={name}
            aria-label={point.label}
            checked={point.value === value}
            className="peer sr-only"
            onChange={() => {
              onChange(point.value)
            }}
          />
          <span
            aria-hidden="true"
            className="block h-8 rounded-sm border border-input bg-muted peer-checked:bg-primary peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50"
          />
        </label>
      ))}
    </div>
  )
}
