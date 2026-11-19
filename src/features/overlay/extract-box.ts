import { clampBox } from '@/features/overlay/box-geometry'
import type { Box, Size } from '@/features/overlay/box-geometry'
import type { SharpStep } from '@/features/pipeline/pipeline'

type Options = SharpStep['options']

function isWhole(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min
}

/**
 * The box of an extract step's options, cut to the picture it acts on. A step
 * that has no region yet, or one that is not a usable region, shows the whole
 * picture, which is what extracting nothing away would be.
 */
export function extractBox(options: Options, bounds: Size): Box {
  const { left, top, width, height } = options
  if (
    isWhole(left, 0) &&
    isWhole(top, 0) &&
    isWhole(width, 1) &&
    isWhole(height, 1)
  ) {
    return clampBox({ left, top, width, height }, bounds)
  }
  return { left: 0, top: 0, width: bounds.width, height: bounds.height }
}

/** The options of an extract step with this region, and nothing else changed. */
export function withExtractBox(options: Options, box: Box): Options {
  return {
    ...options,
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
  }
}
