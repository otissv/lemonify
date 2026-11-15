import { describe, expect, it } from 'vitest'

import {
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_EXTENSIONS,
  EXPORT_FIELDS,
  ExportFormat,
  ExportSettingsSchema,
  defaultExportOptions,
  defaultExportSettings,
  exportFileName,
  visibleExportFields,
} from '@/features/export/export-settings'
import type { ConvertedFormat } from '@/features/export/export-settings'
import {
  FORMAT_EXTENSIONS,
  OUTPUT_OPTION_SCHEMAS,
} from '@/lib/images/sharp/output-options'

const CONVERTED = Object.values(ExportFormat).filter(
  (format): format is ConvertedFormat => format !== ExportFormat.Original,
)

function names(
  format: ExportFormat,
  options: Parameters<typeof visibleExportFields>[1],
): Array<string> {
  return visibleExportFields(format, options).map((field) => field.name)
}

describe('ExportSettingsSchema', () => {
  it('accepts the defaults of every format', () => {
    for (const format of Object.values(ExportFormat)) {
      const settings = defaultExportSettings(format)
      expect(ExportSettingsSchema.parse(settings)).toEqual(settings)
    }
    expect(DEFAULT_EXPORT_SETTINGS.format).toBe(ExportFormat.Original)
  })

  it('has no width: resizing is not part of exporting', () => {
    expect(Object.keys(ExportSettingsSchema.shape)).toEqual([
      'format',
      'options',
      'keepMetadata',
    ])
  })
})

describe('Sharp parity', () => {
  it.each(CONVERTED)('%s defaults are valid Sharp options', (format) => {
    const result = OUTPUT_OPTION_SCHEMAS[format].safeParse(
      defaultExportOptions(format),
    )

    expect(result.error?.issues).toBeUndefined()
  })

  it.each(CONVERTED)('%s uses the CLI’s file extension', (format) => {
    expect(EXPORT_EXTENSIONS[format]).toBe(FORMAT_EXTENSIONS[format])
  })

  it('keeps every field’s range inside what Sharp accepts', () => {
    for (const format of CONVERTED) {
      for (const field of EXPORT_FIELDS[format]) {
        if (field.kind !== 'slider') continue
        for (const value of [field.min, field.max]) {
          const result = OUTPUT_OPTION_SCHEMAS[format].safeParse({
            [field.name]: value,
          })
          expect(result.success, `${format}.${field.name}=${value}`).toBe(true)
        }
      }
    }
  })

  it('offers only choices Sharp accepts', () => {
    for (const format of CONVERTED) {
      for (const field of EXPORT_FIELDS[format]) {
        if (field.kind !== 'select') continue
        for (const choice of field.choices) {
          const result = OUTPUT_OPTION_SCHEMAS[format].safeParse({
            [field.name]: choice,
          })
          expect(result.success, `${format}.${field.name}=${choice}`).toBe(true)
        }
      }
    }
  })
})

describe('visibleExportFields', () => {
  it('shows only the chosen format’s fields', () => {
    expect(names(ExportFormat.Original, {})).toEqual([])
    expect(
      names(ExportFormat.Jpeg, defaultExportOptions(ExportFormat.Jpeg)),
    ).toEqual(['quality', 'mozjpeg', 'progressive', 'chromaSubsampling'])
    expect(
      names(ExportFormat.Png, defaultExportOptions(ExportFormat.Png)),
    ).toEqual(['compressionLevel', 'progressive', 'palette'])
  })

  it('hides Quality once Lossless is on', () => {
    expect(names(ExportFormat.Webp, { lossless: false })).toContain('quality')
    expect(names(ExportFormat.Webp, { lossless: true })).not.toContain(
      'quality',
    )
  })

  it('shows TIFF quality only for lossy compression', () => {
    expect(names(ExportFormat.Tiff, { compression: 'jpeg' })).toContain(
      'quality',
    )
    expect(names(ExportFormat.Tiff, { compression: 'lzw' })).not.toContain(
      'quality',
    )
  })
})

describe('exportFileName', () => {
  it('uses the chosen format’s extension', () => {
    expect(exportFileName('me.jpg', ExportFormat.Webp)).toBe('me.webp')
    expect(exportFileName('me.final.png', ExportFormat.Jpeg)).toBe(
      'me.final.jpg',
    )
  })

  it('keeps the name for the original format', () => {
    expect(exportFileName('me.jpg', ExportFormat.Original)).toBe('me.jpg')
  })
})
