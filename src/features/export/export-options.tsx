import { useCallback, useId, useState } from 'react'

import { Button } from '@/components/ui/button'
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
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_FORMAT_LABELS,
  ExportFormat,
  defaultExportSettings,
  visibleExportFields,
} from '@/features/export/export-settings'
import type {
  ExportOptionValue,
  ExportSettings,
} from '@/features/export/export-settings'
import { useExportFormats } from '@/features/export/use-export-formats'
import { Input } from '@/components/ui/input'
import { followJob } from '@/features/jobs/follow-job'
import { requestExport } from '@/features/render/render-functions'
import { resultDownloadUrl } from '@/features/documents/image-urls'
import { errorMessage } from '@/lib/error-message'
import { JobKind, JobState } from '@/server/jobs/job-types'
import { usePreview } from '@/features/pipeline/use-preview'
import { useLibraryStore } from '@/store/library-store'
import { useUiStore } from '@/store/ui-store'
import { documentSession, usePipelineStore } from '@/store/pipeline-store'

interface ExportOptionsProps {
  documentId: string
}

interface ExportFieldsProps {
  settings: ExportSettings
  formats: ReadonlyArray<ExportFormat>
  onChange: (settings: ExportSettings) => void
}

const BLOCKED_BY_RENDER =
  'Run the AI steps and set up every step before exporting.'
const EXPORT_FAILED = 'The image could not be exported.'

function isExportFormat(value: string): value is ExportFormat {
  return Object.values<string>(ExportFormat).includes(value)
}

function ExportFields({
  settings,
  formats,
  onChange,
}: ExportFieldsProps): React.JSX.Element {
  const ids = { format: useId(), metadata: useId() }
  const fields = visibleExportFields(settings.format, settings.options)

  function handleFormatChange(value: string): void {
    if (!isExportFormat(value) || value === settings.format) return
    onChange({
      ...settings,
      ...defaultExportSettings(value),
      keepMetadata: settings.keepMetadata,
    })
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
        <Label id={ids.format}>Format</Label>
        <Select value={settings.format} onValueChange={handleFormatChange}>
          <SelectTrigger aria-labelledby={ids.format} className="w-full">
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
        <Label htmlFor={ids.metadata}>Keep metadata</Label>
        <Switch
          id={ids.metadata}
          checked={settings.keepMetadata}
          onCheckedChange={handleMetadataChange}
        />
      </div>
    </>
  )
}

const PERCENT = 100

function startDownload(resultId: string): void {
  const link = document.createElement('a')
  link.href = resultDownloadUrl(resultId)
  link.rel = 'noopener'
  link.click()
}

/** Exports the image as shown, at full size: the server makes it as a job, and the finished file downloads in the browser. */
export function ExportOptions({
  documentId,
}: ExportOptionsProps): React.JSX.Element {
  const stored = useUiStore((state) => state.exportSettings[documentId])
  const setExportSettings = useUiStore((state) => state.setExportSettings)
  const refreshResults = useLibraryStore((state) => state.refreshResults)
  const session = usePipelineStore((state) =>
    documentSession(state, documentId),
  )
  const preview = usePreview(documentId)
  const blocked =
    (preview?.pending.length ?? 0) > 0 ||
    (preview?.problems.length ?? 0) > 0 ||
    (session?.pending.length ?? 0) > 0
  const formats = useExportFormats()
  const widthId = useId()
  const [width, setWidth] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [exported, setExported] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const settings = stored ?? DEFAULT_EXPORT_SETTINGS
  const exporting = progress !== null

  const handleChange = useCallback(
    (next: ExportSettings): void => {
      setExportSettings(documentId, next)
    },
    [documentId, setExportSettings],
  )

  function handleWidthChange(event: React.ChangeEvent<HTMLInputElement>): void {
    setWidth(event.target.value)
  }

  async function handleExport(): Promise<void> {
    if (!preview || blocked) return
    const chosenWidth = width.trim() === '' ? undefined : Number(width)
    if (
      chosenWidth !== undefined &&
      !(Number.isInteger(chosenWidth) && chosenWidth > 0)
    ) {
      setError('Enter the width as a whole number of pixels.')
      return
    }
    setProgress(0)
    setExported(null)
    setError(null)
    try {
      const queued = await requestExport({
        data: { documentId, settings, width: chosenWidth },
      })
      const ended = await followJob(
        queued.id,
        new AbortController().signal,
        (job) => {
          setProgress(job.progress)
        },
      )
      if (
        ended?.state === JobState.Done &&
        ended.result?.kind === JobKind.Export
      ) {
        void refreshResults()
        startDownload(ended.result.resultId)
        setExported(
          'The export is ready and downloading. It is also kept in Results.',
        )
        return
      }
      setError(ended?.error ?? EXPORT_FAILED)
    } catch (caught) {
      setError(errorMessage(caught, EXPORT_FAILED))
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <ExportFields
        settings={settings}
        formats={formats}
        onChange={handleChange}
      />
      <div className="flex flex-col gap-2">
        <Label htmlFor={widthId}>Width (pixels)</Label>
        <Input
          id={widthId}
          type="number"
          inputMode="numeric"
          min={1}
          placeholder="Keep the size"
          value={width}
          onChange={handleWidthChange}
        />
      </div>
      <Button
        size="sm"
        disabled={exporting || !preview || blocked}
        onClick={() => void handleExport()}
      >
        {exporting
          ? `Exporting ${Math.round((progress ?? 0) * PERCENT)}%`
          : 'Export'}
      </Button>
      <p role="status" className="text-caption break-all text-muted-foreground">
        {exported ?? ''}
        {blocked ? BLOCKED_BY_RENDER : ''}
      </p>
      {error && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
