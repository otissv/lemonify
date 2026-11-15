import { describe, expect, it } from 'vitest'

import { ExportFormat } from '@/features/export/export-settings'
import {
  COMMON_WIDTHS,
  MAX_OUTPUT_WIDTHS,
  OutputSettingsSchema,
  defaultOutputSettings,
  outputFileNames,
  withWidth,
  withoutWidth,
} from '@/features/workflows/output-settings'
import type { OutputSettings } from '@/features/workflows/output-settings'

function settings(change: Partial<OutputSettings>): OutputSettings {
  return { ...defaultOutputSettings(), ...change }
}

describe('defaultOutputSettings', () => {
  it('keeps the original format and size', () => {
    expect(defaultOutputSettings()).toEqual({
      format: ExportFormat.Original,
      options: {},
      keepMetadata: false,
      widths: [],
      suffix: '',
    })
  })

  it('is valid', () => {
    expect(
      OutputSettingsSchema.safeParse(defaultOutputSettings()).success,
    ).toBe(true)
  })
})

describe('OutputSettingsSchema', () => {
  it('has no folder, existing-files policy or manifest: those are CLI flags', () => {
    expect(Object.keys(OutputSettingsSchema.shape).sort()).toEqual([
      'format',
      'keepMetadata',
      'options',
      'suffix',
      'widths',
    ])
  })

  it.each([[[0]], [[-5]], [[1.5]], [[70_000]]])(
    'rejects widths %j',
    (widths) => {
      expect(OutputSettingsSchema.safeParse(settings({ widths })).success).toBe(
        false,
      )
    },
  )

  it('rejects duplicate widths and too many of them', () => {
    expect(
      OutputSettingsSchema.safeParse(settings({ widths: [480, 480] })).success,
    ).toBe(false)
    const many = Array.from({ length: MAX_OUTPUT_WIDTHS + 1 }, (_, i) => i + 1)
    expect(
      OutputSettingsSchema.safeParse(settings({ widths: many })).success,
    ).toBe(false)
  })

  it.each(['/x', 'a/b', '..', 'a b', 'x'.repeat(41)])(
    'rejects the suffix %j',
    (suffix) => {
      expect(OutputSettingsSchema.safeParse(settings({ suffix })).success).toBe(
        false,
      )
    },
  )

  it.each(['', '-small', '_web', '.min'])('accepts the suffix %j', (suffix) => {
    expect(OutputSettingsSchema.safeParse(settings({ suffix })).success).toBe(
      true,
    )
  })
})

describe('withWidth and withoutWidth', () => {
  it('keeps widths unique and smallest first', () => {
    expect(withWidth([768], 480)).toEqual([480, 768])
    expect(withWidth([480, 768], 480)).toEqual([480, 768])
  })

  it('stops at the most widths allowed', () => {
    const full = Array.from({ length: MAX_OUTPUT_WIDTHS }, (_, i) => i + 1)

    expect(withWidth(full, 999)).toEqual(full)
  })

  it('removes one width', () => {
    expect(withoutWidth([480, 768, 1200], 768)).toEqual([480, 1200])
  })

  it('offers common responsive sizes, smallest first', () => {
    expect(COMMON_WIDTHS).toEqual([...COMMON_WIDTHS].sort((a, b) => a - b))
  })
})

describe('outputFileNames', () => {
  it('names one file per width as <name>-<width><ext>', () => {
    expect(
      outputFileNames(
        'me.jpg',
        settings({ format: ExportFormat.Webp, widths: [480, 1200] }),
      ),
    ).toEqual(['me-480.webp', 'me-1200.webp'])
  })

  it('keeps the original extension for the original format', () => {
    expect(outputFileNames('Me.PNG', settings({ widths: [480] }))).toEqual([
      'Me-480.PNG',
    ])
  })

  it('adds the suffix when the size is kept', () => {
    expect(
      outputFileNames(
        'me.jpg',
        settings({ format: ExportFormat.Avif, suffix: '-web' }),
      ),
    ).toEqual(['me-web.avif'])
  })

  it('ignores the suffix when there are widths', () => {
    expect(
      outputFileNames('me.jpg', settings({ widths: [480], suffix: '-web' })),
    ).toEqual(['me-480.jpg'])
  })

  it('handles names with several dots and none', () => {
    expect(outputFileNames('a.b.jpg', settings({ widths: [10] }))).toEqual([
      'a.b-10.jpg',
    ])
    expect(
      outputFileNames('photo', settings({ format: ExportFormat.Png })),
    ).toEqual(['photo.png'])
  })
})
