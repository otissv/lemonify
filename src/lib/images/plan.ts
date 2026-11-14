import path from 'node:path'

export interface VariantTarget {
  sourceFile: string
  sourceRoot: string
  destination: string
  width: number
  /** Output extension including the dot, such as `.webp`. */
  extension: string
}

/**
 * Widths to generate for a source image. Targets wider than the source are
 * dropped so nothing is upscaled; a source narrower than the largest target
 * contributes its own width as the top variant.
 */
export function planWidths(
  sourceWidth: number,
  targetWidths: readonly number[],
): number[] {
  const widths: number[] = []
  let largestTarget = 0
  for (const width of targetWidths) {
    largestTarget = Math.max(largestTarget, width)
    if (width <= sourceWidth) widths.push(width)
  }
  if (sourceWidth < largestTarget && !widths.includes(sourceWidth)) {
    widths.push(sourceWidth)
  }
  return widths.sort((a, b) => a - b)
}

/** `<destination>/<subfolders below sourceRoot>/<name>-<width><extension>`. */
export function variantPath(target: VariantTarget): string {
  const { name, dir } = path.parse(target.sourceFile)
  const relativeDir = path.relative(target.sourceRoot, dir)
  return path.join(
    target.destination,
    relativeDir,
    `${name}-${target.width}${target.extension}`,
  )
}

/** The source file's path relative to `sourceRoot`, placed under `destination`. */
export function mirroredPath(
  sourceFile: string,
  sourceRoot: string,
  destination: string,
): string {
  return path.join(destination, path.relative(sourceRoot, sourceFile))
}
