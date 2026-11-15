import { useEffect, useState } from 'react'

import { getExportFormats } from '@/features/export/export-functions'
import { ExportFormat } from '@/features/export/export-settings'

const FALLBACK_FORMATS: ReadonlyArray<ExportFormat> = [ExportFormat.Original]

/** The formats this machine can write; only "Same as original" until the server answers. */
export function useExportFormats(): ReadonlyArray<ExportFormat> {
  const [formats, setFormats] =
    useState<ReadonlyArray<ExportFormat>>(FALLBACK_FORMATS)

  useEffect(() => {
    let current = true
    getExportFormats().then(
      (available) => {
        if (current) setFormats(available)
      },
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [])

  return formats
}
