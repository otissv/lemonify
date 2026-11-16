import { useEffect, useId, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import {
  LAYER_ANCHORS,
  LAYER_BLENDS,
  LAYER_FITS,
  MAX_LAYER_OFFSET,
  MAX_LAYER_OPACITY,
  MAX_LAYER_ROTATION,
  MAX_LAYER_SCALE,
  MIN_LAYER_OPACITY,
  MIN_LAYER_SCALE,
} from '@/features/pipeline/layer'
import type {
  LayerAnchor,
  LayerBlend,
  LayerFit,
  LayerSettings,
} from '@/features/pipeline/layer'

interface LayerSettingsFormProps {
  settings: LayerSettings
  onChange: (settings: LayerSettings) => void
}

const BLEND_LABELS: Readonly<Record<LayerBlend, string>> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'colour-dodge': 'Colour dodge',
  'colour-burn': 'Colour burn',
  'hard-light': 'Hard light',
  'soft-light': 'Soft light',
  difference: 'Difference',
  exclusion: 'Exclusion',
}

const FIT_LABELS: Readonly<Record<LayerFit, string>> = {
  inside: 'Shrink to fit',
  original: 'Original size',
  contain: 'Fit inside',
  cover: 'Fill',
  stretch: 'Stretch',
}

const ANCHOR_LABELS: Readonly<Record<LayerAnchor, string>> = {
  northwest: 'Top left',
  north: 'Top',
  northeast: 'Top right',
  west: 'Left',
  centre: 'Centre',
  east: 'Right',
  southwest: 'Bottom left',
  south: 'Bottom',
  southeast: 'Bottom right',
}

interface NumberFieldProps {
  label: string
  value: number
  min: number
  max: number
  /** Whole numbers only. */
  whole: boolean
  onCommit: (value: number) => void
}

/**
 * A number that can be cleared and retyped: what is typed stays on screen
 * until the field is left, and only a complete number inside the limits is
 * passed on.
 */
function NumberField({
  label,
  value,
  min,
  max,
  whole,
  onCommit,
}: NumberFieldProps): React.JSX.Element {
  const id = useId()
  const [text, setText] = useState(String(value))

  useEffect(() => {
    setText((current) => (Number(current) === value ? current : String(value)))
  }, [value])

  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const raw = event.target.value
    setText(raw)
    const typed = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(typed)) return
    const limited = Math.min(max, Math.max(min, typed))
    onCommit(whole ? Math.round(limited) : limited)
  }

  function handleBlur(): void {
    setText(String(value))
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode={whole ? 'numeric' : 'decimal'}
        min={min}
        max={max}
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
      />
    </div>
  )
}

interface OptionSelectProps<T extends string> {
  label: string
  value: T
  labels: Readonly<Record<T, string>>
  options: ReadonlyArray<T>
  onChange: (value: T) => void
}

function OptionSelect<T extends string>({
  label,
  value,
  labels,
  options,
  onChange,
}: OptionSelectProps<T>): React.JSX.Element {
  const id = useId()

  function handleValueChange(next: string): void {
    const chosen = options.find((option) => option === next)
    if (chosen !== undefined) onChange(chosen)
  }

  return (
    <div className="flex flex-col gap-2">
      <Label id={id}>{label}</Label>
      <Select value={value} onValueChange={handleValueChange}>
        <SelectTrigger aria-labelledby={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {labels[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

interface AnchorGridProps {
  anchor: LayerAnchor
  onChange: (anchor: LayerAnchor) => void
}

/** The nine points a layer can be placed against, laid out as the canvas is. */
function AnchorGrid({ anchor, onChange }: AnchorGridProps): React.JSX.Element {
  const name = useId()

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-body-md font-medium">Anchor</legend>
      <div className="grid w-28 grid-cols-3 gap-1">
        {LAYER_ANCHORS.map((point) => (
          <label key={point} title={ANCHOR_LABELS[point]} className="block">
            <input
              type="radio"
              name={name}
              aria-label={ANCHOR_LABELS[point]}
              checked={point === anchor}
              className="peer sr-only"
              onChange={() => {
                onChange(point)
              }}
            />
            <span className="block h-8 rounded-sm border border-input bg-muted peer-checked:bg-primary peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50" />
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** How a layer is drawn: its opacity and blend mode, how it is sized, and where it sits on the canvas. */
export function LayerSettingsForm({
  settings,
  onChange,
}: LayerSettingsFormProps): React.JSX.Element {
  const opacityId = useId()

  function handleOpacityChange(values: Array<number>): void {
    const opacity = values.at(0)
    if (opacity !== undefined) onChange({ ...settings, opacity })
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label id={opacityId}>Opacity</Label>
          <span className="text-body-md text-muted-foreground">
            {settings.opacity}%
          </span>
        </div>
        <Slider
          thumbLabel="Opacity"
          aria-describedby={opacityId}
          min={MIN_LAYER_OPACITY}
          max={MAX_LAYER_OPACITY}
          step={1}
          value={[settings.opacity]}
          onValueChange={handleOpacityChange}
        />
      </div>

      <OptionSelect
        label="Blend mode"
        value={settings.blend}
        labels={BLEND_LABELS}
        options={LAYER_BLENDS}
        onChange={(blend) => {
          onChange({ ...settings, blend })
        }}
      />

      <OptionSelect
        label="Fit"
        value={settings.fit}
        labels={FIT_LABELS}
        options={LAYER_FITS}
        onChange={(fit) => {
          onChange({ ...settings, fit })
        }}
      />

      <div className="flex gap-3">
        <NumberField
          label="Scale (%)"
          value={settings.scale}
          min={MIN_LAYER_SCALE}
          max={MAX_LAYER_SCALE}
          whole={false}
          onCommit={(scale) => {
            onChange({ ...settings, scale })
          }}
        />
        <NumberField
          label="Rotation (°)"
          value={settings.rotation}
          min={-MAX_LAYER_ROTATION}
          max={MAX_LAYER_ROTATION}
          whole={false}
          onCommit={(rotation) => {
            onChange({ ...settings, rotation })
          }}
        />
      </div>

      <AnchorGrid
        anchor={settings.anchor}
        onChange={(anchor) => {
          onChange({ ...settings, anchor })
        }}
      />

      <div className="flex gap-3">
        <NumberField
          label="Across (px)"
          value={settings.x}
          min={-MAX_LAYER_OFFSET}
          max={MAX_LAYER_OFFSET}
          whole
          onCommit={(x) => {
            onChange({ ...settings, x })
          }}
        />
        <NumberField
          label="Down (px)"
          value={settings.y}
          min={-MAX_LAYER_OFFSET}
          max={MAX_LAYER_OFFSET}
          whole
          onCommit={(y) => {
            onChange({ ...settings, y })
          }}
        />
      </div>
    </div>
  )
}
