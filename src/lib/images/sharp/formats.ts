import path from 'node:path'

import { readableExtensions } from './capabilities.ts'
import { FORMAT_EXTENSIONS, OUTPUT_FORMATS } from './output-options.ts'
import type { OutputFormat } from './output-options.ts'

const EXTENSION_ALIASES: Readonly<Record<string, OutputFormat>> = {
  '.jpeg': 'jpeg',
  '.jpe': 'jpeg',
  '.tif': 'tiff',
  '.heic': 'heif',
}

function buildExtensionFormats(): ReadonlyMap<string, OutputFormat> {
  const formats = new Map<string, OutputFormat>()
  for (const format of OUTPUT_FORMATS)
    formats.set(FORMAT_EXTENSIONS[format], format)
  for (const [extension, format] of Object.entries(EXTENSION_ALIASES))
    formats.set(extension, format)
  return formats
}

const EXTENSION_FORMATS = buildExtensionFormats()

/** The output format a file's extension names, if Sharp can write it. */
export function formatForFile(file: string): OutputFormat | undefined {
  return EXTENSION_FORMATS.get(path.extname(file).toLowerCase())
}

/** Extensions Sharp can both read and write, so a file can be rewritten in place. */
export function rewritableExtensions(): string[] {
  const extensions: string[] = []
  for (const extension of readableExtensions()) {
    if (EXTENSION_FORMATS.has(extension)) extensions.push(extension)
  }
  return extensions
}
