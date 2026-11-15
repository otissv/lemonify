// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { ExportFormat } from '@/features/export/export-settings'
import { writableExportFormats } from '@/features/export/server/export-formats'

describe('writableExportFormats', () => {
  it('always offers Original and the formats this Sharp build can write', async () => {
    const formats = await writableExportFormats()

    expect(formats).toEqual(
      expect.arrayContaining([
        ExportFormat.Original,
        ExportFormat.Jpeg,
        ExportFormat.Png,
        ExportFormat.Webp,
        ExportFormat.Gif,
        ExportFormat.Tiff,
        ExportFormat.Raw,
      ]),
    )
  })

  it('leaves out formats the build cannot write, instead of failing later', async () => {
    const formats = await writableExportFormats()

    expect(formats).not.toContain(ExportFormat.Jxl)
    expect(formats).not.toContain(ExportFormat.Jp2)
  })

  it('keeps the formats in the order of the picker', async () => {
    const formats = await writableExportFormats()
    const order = Object.values(ExportFormat)

    expect(formats).toEqual(order.filter((format) => formats.includes(format)))
  })
})
