import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

export const imageVariantSchema = z.object({
  /** Variant path relative to the destination folder, POSIX separators. */
  path: z.string().min(1),
  width: z.number().int().positive(),
})
export type ImageVariant = z.infer<typeof imageVariantSchema>

export const imageManifestEntrySchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  variants: z.array(imageVariantSchema),
})
export type ImageManifestEntry = z.infer<typeof imageManifestEntrySchema>

/** Keyed by the source path relative to the source folder, POSIX separators. */
export const imageManifestSchema = z.record(
  z.string(),
  imageManifestEntrySchema,
)
export type ImageManifest = z.infer<typeof imageManifestSchema>

export interface ManifestSource {
  source: string
  width: number
  height: number
  variants: readonly { file: string; width: number }[]
}

function toPosix(relative: string): string {
  return relative.split(path.sep).join('/')
}

export function createManifest(
  results: readonly ManifestSource[],
  sourceRoot: string,
  destination: string,
): ImageManifest {
  const manifest: ImageManifest = {}
  for (const result of results) {
    const variants: ImageVariant[] = []
    for (const variant of result.variants) {
      variants.push({
        path: toPosix(path.relative(destination, variant.file)),
        width: variant.width,
      })
    }
    manifest[toPosix(path.relative(sourceRoot, result.source))] = {
      width: result.width,
      height: result.height,
      variants,
    }
  }
  return manifest
}

export async function writeManifest(
  file: string,
  manifest: ImageManifest,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`)
}
