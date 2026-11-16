import { useId } from 'react'

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
  LAYER_BLENDS,
  MAX_LAYER_OPACITY,
  MIN_LAYER_OPACITY,
} from '@/features/pipeline/layer'
import type { LayerBlend } from '@/features/pipeline/layer'

export const BLEND_LABELS: Readonly<Record<LayerBlend, string>> = {
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

interface OptionSelectProps<T extends string> {
  label: string
  value: T
  labels: Readonly<Record<T, string>>
  options: ReadonlyArray<T>
  onChange: (value: T) => void
}

/** A labelled list of choices, for settings that take one of a few named values. */
export function OptionSelect<T extends string>({
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

interface BlendModeSelectProps {
  value: LayerBlend
  onChange: (mode: LayerBlend) => void
}

/** The blend modes, for a layer and for a step alike. */
export function BlendModeSelect({
  value,
  onChange,
}: BlendModeSelectProps): React.JSX.Element {
  return (
    <OptionSelect
      label="Blend mode"
      value={value}
      labels={BLEND_LABELS}
      options={LAYER_BLENDS}
      onChange={onChange}
    />
  )
}

interface OpacitySliderProps {
  value: number
  onChange: (opacity: number) => void
}

/** Opacity as a percentage, 0 to 100. */
export function OpacitySlider({
  value,
  onChange,
}: OpacitySliderProps): React.JSX.Element {
  const id = useId()

  function handleValueChange(values: Array<number>): void {
    const opacity = values.at(0)
    if (opacity !== undefined) onChange(opacity)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label id={id}>Opacity</Label>
        <span className="text-body-md text-muted-foreground">{value}%</span>
      </div>
      <Slider
        thumbLabel="Opacity"
        aria-describedby={id}
        min={MIN_LAYER_OPACITY}
        max={MAX_LAYER_OPACITY}
        step={1}
        value={[value]}
        onValueChange={handleValueChange}
      />
    </div>
  )
}
