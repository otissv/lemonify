import '@tanstack/react-start/server-only'

import sharp from 'sharp'

import { ExportFormat } from '@/features/export/export-settings'
import type { ConvertedFormat } from '@/features/export/export-settings'

const PROBE_SIZE = 8
const PROBE_BACKGROUND = '#888888'

async function canWrite(format: ConvertedFormat): Promise<boolean> {
  try {
    await sharp({
      create: {
        width: PROBE_SIZE,
        height: PROBE_SIZE,
        channels: 3,
        background: PROBE_BACKGROUND,
      },
    })
      .toFormat(format)
      .toBuffer()
    return true
  } catch {
    return false
  }
}

async function probe(): Promise<Array<ExportFormat>> {
  const formats: Array<ExportFormat> = [ExportFormat.Original]
  for (const format of Object.values(ExportFormat)) {
    if (format === ExportFormat.Original) continue
    if (await canWrite(format)) formats.push(format)
  }
  return formats
}

let cached: Promise<Array<ExportFormat>> | undefined

/**
 * The export formats this Sharp build can write. Builds differ (JPEG XL and
 * JPEG 2000 need libraries not every build has), and Sharp's own capability
 * list is unreliable for AVIF, so each format is tried on a tiny image once.
 */
export function writableExportFormats(): Promise<Array<ExportFormat>> {
  cached ??= probe()
  return cached
}
