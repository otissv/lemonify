import { useId, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ExportFieldControl } from '@/features/export/export-field'
import {
  EXPORT_FORMAT_LABELS,
  ExportFormat,
  defaultExportSettings,
  visibleExportFields,
} from '@/features/export/export-settings'
import type { ExportOptionValue } from '@/features/export/export-settings'
import { useExportFormats } from '@/features/export/use-export-formats'
import { OutputWidths } from '@/features/workflows/output-widths'
import { outputFileNames } from '@/features/workflows/output-settings'
import type { OutputSettings } from '@/features/workflows/output-settings'

interface OutputPanelProps {
  settings: OutputSettings
  /** A file name to show how results are named, e.g. the first input image. */
  sampleName: string
  onChange: (settings: OutputSettings) => void
}

enum SizeMode {
  Keep = 'keep',
  Widths = 'widths',
}

const SIZE_LABELS: Readonly<Record<SizeMode, string>> = {
  [SizeMode.Keep]: 'Keep size',
  [SizeMode.Widths]: 'Responsive widths',
}

function isExportFormat(value: string): value is ExportFormat {
  return Object.values<string>(ExportFormat).includes(value)
}

function isSizeMode(value: string): value is SizeMode {
  return Object.values<string>(SizeMode).includes(value)
}

function FormatFields({
  settings,
  onChange,
}: Pick<OutputPanelProps, 'settings' | 'onChange'>): React.JSX.Element {
  const formats = useExportFormats()
  const formatId = useId()
  const fields = visibleExportFields(settings.format, settings.options)

  function handleFormatChange(value: string): void {
    if (!isExportFormat(value) || value === settings.format) return
    const { format, options } = defaultExportSettings(value)
    onChange({ ...settings, format, options })
  }

  function handleOptionChange(name: string, value: ExportOptionValue): void {
    onChange({ ...settings, options: { ...settings.options, [name]: value } })
  }

  function handleMetadataChange(keepMetadata: boolean): void {
    onChange({ ...settings, keepMetadata })
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label id={formatId}>Format</Label>
        <Select value={settings.format} onValueChange={handleFormatChange}>
          <SelectTrigger aria-labelledby={formatId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {formats.map((format) => (
              <SelectItem key={format} value={format}>
                {EXPORT_FORMAT_LABELS[format]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {fields.map((field) => (
        <ExportFieldControl
          key={`${settings.format}-${field.name}`}
          field={field}
          value={settings.options[field.name]}
          onChange={handleOptionChange}
        />
      ))}
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`${formatId}-metadata`}>Keep metadata</Label>
        <Switch
          id={`${formatId}-metadata`}
          checked={settings.keepMetadata}
          onCheckedChange={handleMetadataChange}
        />
      </div>
    </>
  )
}

function SizeFields({
  settings,
  onChange,
}: Pick<OutputPanelProps, 'settings' | 'onChange'>): React.JSX.Element {
  const ids = { size: useId(), suffix: useId() }
  const [mode, setMode] = useState(
    settings.widths.length > 0 ? SizeMode.Widths : SizeMode.Keep,
  )

  function handleModeChange(value: string): void {
    if (!isSizeMode(value)) return
    setMode(value)
    if (value === SizeMode.Keep) onChange({ ...settings, widths: [] })
  }

  function handleWidthsChange(widths: Array<number>): void {
    onChange({ ...settings, widths })
  }

  function handleSuffixChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ): void {
    onChange({ ...settings, suffix: event.target.value })
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label id={ids.size}>Size</Label>
        <Select value={mode} onValueChange={handleModeChange}>
          <SelectTrigger aria-labelledby={ids.size} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.values(SizeMode).map((value) => (
              <SelectItem key={value} value={value}>
                {SIZE_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {mode === SizeMode.Keep ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={ids.suffix}>Suffix</Label>
          <Input
            id={ids.suffix}
            value={settings.suffix}
            placeholder="None"
            onChange={handleSuffixChange}
          />
        </div>
      ) : (
        <OutputWidths widths={settings.widths} onChange={handleWidthsChange} />
      )}
    </>
  )
}

/** How the workflow makes its results: in which format and at which sizes. Where they are written is chosen when they are fetched. */
export function OutputPanel({
  settings,
  sampleName,
  onChange,
}: OutputPanelProps): React.JSX.Element {
  const names = outputFileNames(sampleName, settings)

  return (
    <div className="flex flex-col gap-4 p-4">
      <FormatFields settings={settings} onChange={onChange} />
      <SizeFields settings={settings} onChange={onChange} />
      <div className="flex flex-col gap-1">
        <h3 className="text-caption font-medium text-muted-foreground">
          Files per image
        </h3>
        <ul aria-label="Files per image" className="text-caption">
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
