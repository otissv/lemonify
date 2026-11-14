import path from 'node:path'
import sharp from 'sharp'
import type { Metadata, Stats } from 'sharp'
import { z } from 'zod'

import { parseWithSchema } from '../options.ts'
import { collectSources } from '../sources.ts'
import { readableExtensions } from './capabilities.ts'
import { filePathSchema } from './common.ts'

export const inspectOptionsSchema = z.strictObject({
  source: filePathSchema,
  stats: z.boolean().default(false),
  recursive: z.boolean().default(false),
})
export type InspectOptionsInput = z.input<typeof inspectOptionsSchema>

/** A binary block (EXIF, ICC, XMP, …) replaced by its size so the result stays JSON. */
export interface BinarySummary {
  bytes: number
}

type JsonSafe<T> = T extends Buffer
  ? BinarySummary
  : T extends readonly (infer U)[]
    ? JsonSafe<U>[]
    : T extends object
      ? { [K in keyof T]: JsonSafe<T[K]> }
      : T

export type ImageMetadata = JsonSafe<Metadata>

export interface InspectResult {
  file: string
  metadata: ImageMetadata
  stats?: Stats
}

function toJsonSafe<T>(value: T): JsonSafe<T>
function toJsonSafe(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return { bytes: value.byteLength }
  if (Array.isArray(value)) {
    const items: unknown[] = []
    for (const item of value) items.push(toJsonSafe(item))
    return items
  }
  if (value === null || typeof value !== 'object') return value
  const entries: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value))
    entries[key] = toJsonSafe(item)
  return entries
}

async function inspectFile(
  file: string,
  withStats: boolean,
): Promise<InspectResult> {
  const image = sharp(file)
  const metadata = toJsonSafe(await image.metadata())
  if (!withStats) return { file, metadata }
  return { file, metadata, stats: await image.stats() }
}

/** Reads metadata (and optionally pixel statistics) for an image or every image in a folder. */
export async function inspectImages(
  input: InspectOptionsInput,
): Promise<InspectResult[]> {
  const options = parseWithSchema(inspectOptionsSchema, input)
  const sources = await collectSources(path.resolve(options.source), {
    recursive: options.recursive,
    extensions: readableExtensions(),
  })
  const results: InspectResult[] = []
  for (const file of sources.files)
    results.push(await inspectFile(file, options.stats))
  return results
}
