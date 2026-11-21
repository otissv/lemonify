import { AnchorGrid, COMPASS_POINTS } from '@/components/ui/anchor-grid'
import type { CompassPoint } from '@/components/ui/anchor-grid'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ControlProps } from '@/features/workflows/fields/control-props'

enum SmartCrop {
  Off = 'off',
  Entropy = 'entropy',
  Attention = 'attention',
}

const SMART_CROP_LABELS: Readonly<Record<SmartCrop, string>> = {
  [SmartCrop.Off]: 'Off',
  [SmartCrop.Entropy]: 'Entropy: the most detailed part',
  [SmartCrop.Attention]: 'Attention: the most striking part',
}

/** Sharp's other names for the nine points: its position words, and the US centre. */
const POINT_ALIASES: Readonly<Record<string, CompassPoint>> = {
  'left top': 'northwest',
  top: 'north',
  'right top': 'northeast',
  left: 'west',
  center: 'centre',
  right: 'east',
  'left bottom': 'southwest',
  bottom: 'south',
  'right bottom': 'southeast',
}

function isCompassPoint(value: unknown): value is CompassPoint {
  return COMPASS_POINTS.some((point) => point.value === value)
}

/** The grid point a saved position stands for, however it was written. */
export function compassPointOf(value: unknown): CompassPoint | undefined {
  if (isCompassPoint(value)) return value
  if (typeof value !== 'string') return undefined
  return POINT_ALIASES[value]
}

function smartCropOf(value: unknown): SmartCrop {
  if (value === SmartCrop.Entropy) return SmartCrop.Entropy
  if (value === SmartCrop.Attention) return SmartCrop.Attention
  return SmartCrop.Off
}

/**
 * Which part of the picture a crop or fit keeps: a point on a grid laid out as
 * the picture is, or a smart crop that finds the part that matters. Nothing on
 * the grid is chosen until a point is, which keeps Sharp's default, the centre.
 */
export function PositionControl({
  field,
  value,
  onChange,
  id,
  labelId,
  describedBy,
}: ControlProps & { labelId: string }): React.JSX.Element {
  const smartId = `${id}-smart`

  function handlePoint(point: CompassPoint): void {
    onChange(field.name, point)
  }

  function handleSmartCrop(choice: string): void {
    onChange(field.name, choice === SmartCrop.Off ? undefined : choice)
  }

  return (
    <div className="flex flex-col gap-3" aria-describedby={describedBy}>
      <AnchorGrid
        labelledBy={labelId}
        points={COMPASS_POINTS}
        value={compassPointOf(value)}
        onChange={handlePoint}
      />
      <div className="flex flex-col gap-2">
        <Label htmlFor={smartId} className="text-caption">
          Smart crop
        </Label>
        <Select value={smartCropOf(value)} onValueChange={handleSmartCrop}>
          <SelectTrigger
            id={smartId}
            aria-label="Smart crop"
            className="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.values(SmartCrop).map((choice) => (
              <SelectItem key={choice} value={choice}>
                {SMART_CROP_LABELS[choice]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
