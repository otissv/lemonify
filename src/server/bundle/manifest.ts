import { z } from 'zod'

import { MAX_DOCUMENT_NAME_LENGTH } from '@/features/documents/document'
import { PipelineSchema } from '@/features/pipeline/pipeline'

import { ValidationError } from '../errors.ts'
import { SOURCE_MEDIA_TYPES } from '../tools/image-inspector.ts'

export const BUNDLE_FORMAT = 'lemonify-document'
export const BUNDLE_VERSION = 2
export const MANIFEST_ENTRY = 'manifest.json'
/** The most a manifest may hold; it lists a pipeline, not images. */
export const MAX_MANIFEST_BYTES = 8 * 1024 * 1024

const NOT_A_BUNDLE = 'That file is not a Lemonify document.'
const NEWER_VERSION =
  'This document was made by a newer version of Lemonify. Update Lemonify to open it.'
const OLDER_VERSION =
  'This document was made by an older version of Lemonify, before images were layers, so it cannot be opened. Open it in that version and save it again, or add its images again here.'
const INVALID = 'The document file is not valid.'

function isUnique(values: ReadonlyArray<string>): boolean {
  return new Set(values).size === values.length
}

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/)
const fileNameSchema = z.string().min(1).max(255)

/** An image the layers and second images of the document use, by the id its pipeline gives it. */
const sourceEntrySchema = z.strictObject({
  id: z.string().min(1),
  hash: hashSchema,
  fileName: fileNameSchema,
})

/** The finished image of an AI step, by the key the pipeline up to that step makes. */
const resultEntrySchema = z.strictObject({
  key: hashSchema,
  hash: hashSchema,
  stepId: z.uuid(),
  fileName: fileNameSchema,
  mediaType: z.enum(SOURCE_MEDIA_TYPES),
})

/**
 * What a document file says about the document: its name and pipeline, and a
 * list of the images it holds. The images are stored by the hash of their
 * bytes (`objects/<hash>`), so an image used twice is stored once and anything
 * that already has an image by its hash does not need it sent again.
 */
export const ManifestSchema = z
  .strictObject({
    format: z.literal(BUNDLE_FORMAT),
    version: z.literal(BUNDLE_VERSION),
    name: z.string().min(1).max(MAX_DOCUMENT_NAME_LENGTH),
    pipeline: PipelineSchema,
    sources: z.array(sourceEntrySchema),
    results: z.array(resultEntrySchema),
  })
  .refine(
    ({ sources }) => isUnique(sources.map(({ id }) => id)),
    'An image is listed twice.',
  )
  .refine(
    ({ results }) =>
      isUnique(results.map(({ key }) => key)) &&
      isUnique(results.map(({ stepId }) => stepId)),
    'A result is listed twice.',
  )

export type Manifest = z.output<typeof ManifestSchema>

const HeaderSchema = z.looseObject({
  format: z.literal(BUNDLE_FORMAT),
  version: z.number(),
})

export function objectEntry(hash: string): string {
  return `objects/${hash}`
}

/** Reads a manifest, saying in plain words why it is refused. */
export function parseManifest(bytes: Buffer): Manifest {
  let json: unknown
  try {
    json = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new ValidationError(NOT_A_BUNDLE)
  }
  const header = HeaderSchema.safeParse(json)
  if (!header.success) throw new ValidationError(NOT_A_BUNDLE)
  if (header.data.version > BUNDLE_VERSION) {
    throw new ValidationError(NEWER_VERSION)
  }
  if (header.data.version < BUNDLE_VERSION) {
    throw new ValidationError(OLDER_VERSION)
  }
  const manifest = ManifestSchema.safeParse(json)
  if (!manifest.success) throw new ValidationError(INVALID)
  return manifest.data
}
