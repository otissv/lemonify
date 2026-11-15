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
import { Switch } from '@/components/ui/switch'
import type {
  ExportField,
  ExportOptionValue,
} from '@/features/export/export-settings'

interface ExportFieldControlProps {
  field: ExportField
  value: ExportOptionValue | undefined
  onChange: (name: string, value: ExportOptionValue) => void
}

/** One option of the chosen format: a slider, a switch or a choice. */
export function ExportFieldControl({
  field,
  value,
  onChange,
}: ExportFieldControlProps): React.JSX.Element {
  const id = useId()

  if (field.kind === 'switch') {
    return (
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{field.label}</Label>
        <Switch
          id={id}
          checked={value === true}
          onCheckedChange={(checked) => onChange(field.name, checked)}
        />
      </div>
    )
  }

  if (field.kind === 'select') {
    return (
      <div className="flex flex-col gap-2">
        <Label id={id}>{field.label}</Label>
        <Select
          value={typeof value === 'string' ? value : field.default}
          onValueChange={(choice) => onChange(field.name, choice)}
        >
          <SelectTrigger aria-labelledby={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.choices.map((choice) => (
              <SelectItem key={choice} value={choice}>
                {choice}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  const current = typeof value === 'number' ? value : field.default
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label id={id}>{field.label}</Label>
        <span className="text-body-md text-muted-foreground">{current}</span>
      </div>
      <Slider
        thumbLabel={field.label}
        min={field.min}
        max={field.max}
        step={field.step}
        value={[current]}
        onValueChange={(values) => {
          const next = values.at(0)
          if (next !== undefined) onChange(field.name, next)
        }}
      />
    </div>
  )
}
