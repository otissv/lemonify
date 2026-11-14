import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { encodeImage, readOrientedSize, writeOutput } from './encode.ts'
import { OutputCollisionError } from './errors.ts'
import { createManifest, writeManifest } from './manifest.ts'
import type { ManifestSource } from './manifest.ts'
import { parseBuildOptions } from './options.ts'
import type { BuildOptions, BuildOptionsInput } from './options.ts'
import { planWidths, variantPath } from './plan.ts'
import { collectSources } from './sources.ts'
import type { ImageSources } from './sources.ts'

export interface BuiltVariant {
  file: string
  width: number
}

export interface BuildResult extends ManifestSource {
  source: string
  width: number
  height: number
  variants: BuiltVariant[]
}

async function planBuild(
  sources: ImageSources,
  destination: string,
  options: BuildOptions,
): Promise<BuildResult[]> {
  const owners = new Map<string, string>()
  const plans: BuildResult[] = []
  for (const source of sources.files) {
    const { width, height } = await readOrientedSize(source)
    const variants: BuiltVariant[] = []
    for (const variantWidth of planWidths(width, options.widths)) {
      const file = variantPath({
        sourceFile: source,
        sourceRoot: sources.root,
        destination,
        width: variantWidth,
        format: options.format,
      })
      const owner = owners.get(file)
      if (owner !== undefined)
        throw new OutputCollisionError(file, owner, source)
      owners.set(file, source)
      variants.push({ file, width: variantWidth })
    }
    plans.push({ source, width, height, variants })
  }
  return plans
}

/**
 * Writes one resized variant per planned width for every source image.
 * Every source is decoded and every output path checked before anything is
 * written; existing files in the destination are overwritten only when a
 * variant has the same name, and nothing is ever deleted.
 */
export async function buildImages(
  input: BuildOptionsInput,
): Promise<BuildResult[]> {
  const options = parseBuildOptions(input)
  const source = path.resolve(options.source)
  const destination = path.resolve(options.destination)
  const sources = await collectSources(source, {
    recursive: options.recursive,
    exclude: destination,
  })
  const plans = await planBuild(sources, destination, options)

  await mkdir(destination, { recursive: true })
  for (const plan of plans) {
    const original = await readFile(plan.source)
    for (const variant of plan.variants) {
      const data = await encodeImage(
        original,
        {
          width: variant.width,
          format: options.format,
          quality: options.quality,
        },
        plan.source,
      )
      await writeOutput(variant.file, data)
    }
  }
  if (options.manifest !== undefined) {
    const manifest = createManifest(plans, sources.root, destination)
    await writeManifest(path.resolve(options.manifest), manifest)
  }
  return plans
}
