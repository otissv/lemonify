import type { SharpStep } from '@/features/pipeline/pipeline'

type Options = SharpStep['options']

const IDENTITY_2 = [
  [1, 0],
  [0, 1],
]
const IDENTITY_3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]
/** A 3 × 3 kernel that keeps each pixel as it is. */
const IDENTITY_KERNEL = [0, 0, 0, 0, 1, 0, 0, 0, 0]
const SAME_SIZE_PERCENT = 100
const SMALLEST_KERNEL = 3
const SCREEN_DENSITY = 72
/** The smallest XMP packet: metadata with nothing in it, for the person to fill. */
const EMPTY_XMP = '<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>'

/**
 * What the website fills in when it adds a Sharp step, so a new step is
 * usable at once instead of saying what it needs. Where there is a value that
 * leaves the picture as it was (100%, an identity matrix), the step starts
 * there; otherwise it starts with a plain choice to change (red for a tint,
 * sRGB for a profile). The command line has no starting values: a script says
 * what it wants, and the schema still requires these options. Extract has
 * none, since the canvas gives it the whole picture as its region.
 */
const STARTING_OPTIONS: Readonly<Record<string, Options>> = {
  scale: { percent: SAME_SIZE_PERCENT },
  opacity: { percent: SAME_SIZE_PERCENT },
  affine: { matrix: IDENTITY_2 },
  recomb: { matrix: IDENTITY_3 },
  convolve: {
    width: SMALLEST_KERNEL,
    height: SMALLEST_KERNEL,
    kernel: IDENTITY_KERNEL,
  },
  clahe: { width: SMALLEST_KERNEL, height: SMALLEST_KERNEL },
  boolean: { operator: 'and' },
  bandbool: { operator: 'and' },
  pipelineColourspace: { colourspace: 'srgb' },
  toColourspace: { colourspace: 'srgb' },
  extractChannel: { channel: 0 },
  toFormat: { format: 'png' },
  withDensity: { density: SCREEN_DENSITY },
  tint: { colour: '#ff0000' },
  timeout: { seconds: 0 },
  withExif: { exif: {} },
  withExifMerge: { exif: {} },
  withIccProfile: { icc: 'srgb' },
  withXmp: { xmp: EMPTY_XMP },
}

/** Options that name another image, filled with the one the step is given. */
const IMAGE_OPTIONS: Readonly<Record<string, (imageId: string) => Options>> = {
  boolean: (imageId) => ({ operand: imageId }),
  joinChannel: (imageId) => ({ images: [imageId] }),
  composite: (imageId) => ({ images: [{ input: imageId }] }),
}

export interface StartingContext {
  /** An image a step that needs another image starts with, such as the document's own. */
  imageId?: string
}

/** The options a new step of this op starts with on the website, as a fresh copy. */
export function startingSharpOptions(
  op: string,
  context: StartingContext = {},
): Options {
  const options = structuredClone(STARTING_OPTIONS[op] ?? {})
  const image = IMAGE_OPTIONS[op]
  if (image === undefined || context.imageId === undefined) return options
  return { ...options, ...image(context.imageId) }
}
