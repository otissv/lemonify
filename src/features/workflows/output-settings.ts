import { z } from 'zod'

import {
  EXPORT_EXTENSIONS,
  ExportFormat,
  ExportSettingsSchema,
  defaultExportSettings,
} from '@/features/export/export-settings'

export const MAX_OUTPUT_WIDTHS = 12
export const COMMON_WIDTHS: ReadonlyArray<number> = [480, 768, 1024, 1440]
const MAX_SUFFIX_LENGTH = 40

export const MAX_OUTPUT_WIDTH = 65_535

const WidthSchema = z.number().int().positive().max(MAX_OUTPUT_WIDTH)

/**
 * How a workflow makes its results: in which format and at which sizes. It
 * reuses the Export panel's format and options; `widths` makes one image per
 * width (responsive images), and an empty list keeps the size. Where the
 * results are written is a choice of the CLI command that fetches them.
 */
export const OutputSettingsSchema = ExportSettingsSchema.extend({
  widths: z
    .array(WidthSchema)
    .max(MAX_OUTPUT_WIDTHS)
    .refine((widths) => new Set(widths).size === widths.length, {
      message: 'Each width can be used once',
    }),
  suffix: z
    .string()
    .max(MAX_SUFFIX_LENGTH)
    .regex(/^[\w.-]*$/, 'Use letters, numbers, dots, dashes and underscores')
    .refine((suffix) => !suffix.includes('..'), {
      message: 'A suffix cannot contain ..',
    }),
})

export type OutputSettings = z.infer<typeof OutputSettingsSchema>

export function defaultOutputSettings(): OutputSettings {
  const { format, options, keepMetadata } = defaultExportSettings(
    ExportFormat.Original,
  )
  return {
    format,
    options,
    keepMetadata,
    widths: [],
    suffix: '',
  }
}

/** The widths with `width` added: each once, smallest first, no more than the limit. */
export function withWidth(
  widths: ReadonlyArray<number>,
  width: number,
): Array<number> {
  if (widths.includes(width) || widths.length >= MAX_OUTPUT_WIDTHS)
    return [...widths]
  return [...widths, width].sort((a, b) => a - b)
}

export function withoutWidth(
  widths: ReadonlyArray<number>,
  width: number,
): Array<number> {
  return widths.filter((candidate) => candidate !== width)
}

/** The files one image becomes: `<name>-<width>` per width, or `<name><suffix>` when the size is kept. */
export function outputFileNames(
  sourceName: string,
  settings: OutputSettings,
): Array<string> {
  const dot = sourceName.lastIndexOf('.')
  const stem = dot > 0 ? sourceName.slice(0, dot) : sourceName
  const sourceExtension = dot > 0 ? sourceName.slice(dot) : ''
  const extension =
    settings.format === ExportFormat.Original
      ? sourceExtension
      : EXPORT_EXTENSIONS[settings.format]
  if (settings.widths.length === 0)
    return [`${stem}${settings.suffix}${extension}`]
  return settings.widths.map((width) => `${stem}-${width}${extension}`)
}
