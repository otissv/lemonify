import { useEffect, useId, useState } from 'react'

import { AnchorGrid, COMPASS_POINTS } from '@/components/ui/anchor-grid'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  LAYER_FITS,
  MAX_LAYER_OFFSET,
  MAX_LAYER_ROTATION,
  MAX_LAYER_SCALE,
  MIN_LAYER_SCALE,
} from '@/features/pipeline/layer'
import {
  BlendModeSelect,
  OpacitySlider,
  OptionSelect,
} from '@/features/tools/blend-controls'
import type {
  LayerAnchor,
  LayerFit,
  LayerSettings,
} from '@/features/pipeline/layer'

interface LayerSettingsFormProps {
  settings: LayerSettings
  onChange: (settings: LayerSettings) => void
}

const FIT_LABELS: Readonly<Record<LayerFit, string>> = {
  inside: 'Shrink to fit',
  original: 'Original size',
  contain: 'Fit inside',
  cover: 'Fill',
  stretch: 'Stretch',
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

interface LayerAnchorFieldProps {
  anchor: LayerAnchor
  onChange: (anchor: LayerAnchor) => void
}

/** The nine points a layer can be placed against, laid out as the canvas is. */
function LayerAnchorField({
  anchor,
  onChange,
}: LayerAnchorFieldProps): React.JSX.Element {
  const legendId = useId()

  return (
    <fieldset className="flex flex-col gap-2">
      <legend id={legendId} className="mb-2 text-body-md font-medium">
        Anchor
      </legend>
      <AnchorGrid
        labelledBy={legendId}
        points={COMPASS_POINTS}
        value={anchor}
        onChange={onChange}
      />
    </fieldset>
  )
}

/** How a layer is drawn: its opacity and blend mode, how it is sized, and where it sits on the canvas. */
export function LayerSettingsForm({
  settings,
  onChange,
}: LayerSettingsFormProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4 p-4">
      <OpacitySlider
        value={settings.opacity}
        onChange={(opacity) => {
          onChange({ ...settings, opacity })
        }}
      />

      <BlendModeSelect
        value={settings.blend}
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

      <LayerAnchorField
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
